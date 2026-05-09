// src/main/loop/quote-verifier.ts — 业务层: 兜底摘要的引用验证 + 实体接地
//
// 两个独立但互补的校验器:
//   1. verifyQuotedFacts: 引号内 ≥20 字节片段必须出现在 tool_output 集合,否则
//      替换为 ⟨unverifiable⟩。捕捉"伪造引用"。
//   2. verifyEntityGrounding (C2): 摘要里出现的具体实体（公司名/股票代号/路径
//      /中文 ≥3 字专名）必须接地于 instruction 或 tool_output 集合,否则替换为
//      ⟨ungrounded:X⟩。捕捉"实体漂移"——例如指令是百度但模型说中际旭创。
//
// 两者都不依赖 prompt 自我约束,完全在代码层强制。
//
// 阈值 20 的取舍 (verifyQuotedFacts):
//   - 太短:文件名 / 单个错误码等会频繁误命中/误不命中,噪声大
//   - 太长:漏过一些真实编造的中等长度片段
//   - 20 字节大约对应一整句话的起步长度,兼顾信噪比
//
// 不处理的情况:
//   - 未加引号的直接陈述("I called the read tool"):无法界定边界,交给 prompt
//   - 引号内嵌套转义:按字面匹配,不还原 \" \n 等(摘要极少产出这种)

import { extractEntities } from '../agent/entity-extractor'

const MIN_QUOTE_LEN = 20

// 匹配 "..." 或 `...` 中长度 >= MIN_QUOTE_LEN 的片段。
// 不匹配 '...'(单引号在中文与代码里歧义太多,保留给 apostrophe 用)。
// 非贪婪,不跨行——跨行引用极罕见且多为格式错误,不处理。
const QUOTE_RE = new RegExp(`"([^"\\n]{${MIN_QUOTE_LEN},})"|\`([^\`\\n]{${MIN_QUOTE_LEN},})\``, 'g')

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 扫描 text 中的长引用,未在任何 toolOutput 里找到的替换为 ⟨unverifiable⟩。
 *
 * 返回:
 *   - cleaned:          处理后的文本
 *   - unverifiedCount:  被替换的引用条数(供日志 / UI 标注使用)
 */
export function verifyQuotedFacts(
  text: string,
  toolOutputs: string[],
): { cleaned: string; unverifiedCount: number } {
  if (!text) return { cleaned: text, unverifiedCount: 0 }
  // 即便没有工具输出也要扫描——此时所有长引用都应视为不可验证,避免"本来就
  // 没源数据还装作引用"的情况继续流出。
  const normCorpus = normalizeWhitespace(toolOutputs.join('\n'))

  let unverifiedCount = 0
  const cleaned = text.replace(
    QUOTE_RE,
    (match, dq: string | undefined, bq: string | undefined) => {
      const quoted = dq ?? bq ?? ''
      if (quoted.length < MIN_QUOTE_LEN) return match
      const normQuoted = normalizeWhitespace(quoted)
      if (normCorpus.includes(normQuoted)) return match
      unverifiedCount++
      return '⟨unverifiable⟩'
    },
  )
  return { cleaned, unverifiedCount }
}

// ─── C2: entity grounding ──────────────────────────────────────────

/**
 * 扫描 text 中"高置信度实体"(ticker / stock-code / path / 中文 ≥3 字),
 * 凡未接地于 instruction 或 toolOutputs 任一文本的,替换为 ⟨ungrounded:X⟩。
 *
 * 接地判定: 实体字符串作为子串出现在 instruction OR toolOutputs.join 中。
 * 子串匹配双向放行（避免实体抽取的边界误差导致误伤）：
 *   E 在 sourceText 中出现 → 接地
 *   sourceText 含某子串 sub 且 E.includes(sub) → 接地（sourceText 表达了同一实体的更长形式）
 *
 * 不会替换：
 *   - 2 字中文（误伤过高，留给 verifyQuotedFacts / 人工 review）
 *   - 极短 ticker（< 2 字符）
 *
 * 与 verifyQuotedFacts 的关系：两者独立运行；典型用法是先后调用,在最终输出
 * 上叠加两层兜底标记。
 */
export function verifyEntityGrounding(
  text: string,
  groundingSources: { instruction?: string; toolOutputs?: string[] },
): { cleaned: string; ungroundedCount: number; ungroundedEntities: string[] } {
  if (!text) return { cleaned: text, ungroundedCount: 0, ungroundedEntities: [] }

  const instructionText = groundingSources.instruction ?? ''
  const toolOutputCorpus = (groundingSources.toolOutputs ?? []).join('\n')
  const sourceCorpus = `${instructionText}\n${toolOutputCorpus}`

  // 仅取高置信度实体。cn-name 提到 ≥4 字: 3 字组合（价飘摇、风飘摇等）多为
  // 动词/形容词组合,误伤过高;4 字 + 才更可能是真实专有名词或具名实体。
  const entities = extractEntities(text).filter((e) => {
    if (e.category === 'cn-name') return e.text.length >= 4
    return true
  })
  if (entities.length === 0) return { cleaned: text, ungroundedCount: 0, ungroundedEntities: [] }

  const uniqueEntities = Array.from(new Set(entities.map((e) => e.text))).sort(
    (a, b) => b.length - a.length,
  )

  const sourceEntityTexts = new Set<string>(extractEntities(sourceCorpus).map((e) => e.text))

  // 1) 判定每个实体是否 ungrounded
  const ungrounded: string[] = []
  for (const ent of uniqueEntities) {
    if (sourceCorpus.includes(ent)) continue
    let foundReverse = false
    for (const se of sourceEntityTexts) {
      if (ent.includes(se)) {
        foundReverse = true
        break
      }
    }
    if (foundReverse) continue
    ungrounded.push(ent)
  }
  if (ungrounded.length === 0) return { cleaned: text, ungroundedCount: 0, ungroundedEntities: [] }

  // 2) 用区间调度做不重叠替换:长实体优先占位,短实体若区间被覆盖则跳过。
  //    避免简单 split/join 导致 placeholder 内的字符再被后续实体匹配的嵌套 BUG。
  type Range = { start: number; end: number; entity: string }
  const ranges: Range[] = []
  for (const ent of ungrounded) {
    let idx = 0
    while ((idx = text.indexOf(ent, idx)) !== -1) {
      const end = idx + ent.length
      const overlaps = ranges.some((r) => idx < r.end && end > r.start)
      if (!overlaps) ranges.push({ start: idx, end, entity: ent })
      idx = end
    }
  }
  ranges.sort((a, b) => a.start - b.start)

  let cleaned = ''
  let cursor = 0
  for (const r of ranges) {
    cleaned += text.slice(cursor, r.start)
    cleaned += `⟨ungrounded:${r.entity}⟩`
    cursor = r.end
  }
  cleaned += text.slice(cursor)

  // ungroundedEntities 仅记录"被实际占位"的实体（其它被区间覆盖的不计）
  const usedEntities = Array.from(new Set(ranges.map((r) => r.entity)))

  return { cleaned, ungroundedCount: usedEntities.length, ungroundedEntities: usedEntities }
}
