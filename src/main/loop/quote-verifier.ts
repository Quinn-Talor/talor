// src/main/loop/quote-verifier.ts — 业务层: 兜底摘要的引用验证
//
// 兜底摘要的唯一信息源是最近若干条 tool_output。Prompt 指示模型"逐字引用",
// 但这条约束无法被 prompt 自我保证——模型可能把不存在的内容用引号包起来,
// 用户按引号相信却查不到出处。
//
// 这里把校验落到代码:对摘要文本里所有长引用(≥MIN_QUOTE_LEN 字节)做子串核对,
// 未命中的替换为 ⟨unverifiable⟩。空白差异(换行变空格、连续空格)做规范化后仍能命中。
//
// 阈值 20 的取舍:
//   - 太短:文件名 / 单个错误码等会频繁误命中/误不命中,噪声大
//   - 太长:漏过一些真实编造的中等长度片段
//   - 20 字节大约对应一整句话的起步长度,兼顾信噪比
//
// 不处理的情况:
//   - 未加引号的直接陈述("I called the read tool"):无法界定边界,交给 prompt
//   - 引号内嵌套转义:按字面匹配,不还原 \" \n 等(摘要极少产出这种)

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
  const cleaned = text.replace(QUOTE_RE, (match, dq: string | undefined, bq: string | undefined) => {
    const quoted = (dq ?? bq ?? '')
    if (quoted.length < MIN_QUOTE_LEN) return match
    const normQuoted = normalizeWhitespace(quoted)
    if (normCorpus.includes(normQuoted)) return match
    unverifiedCount++
    return '⟨unverifiable⟩'
  })
  return { cleaned, unverifiedCount }
}
