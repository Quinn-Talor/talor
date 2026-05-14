// src/main/agent/entity-extractor.ts — 业务层：实体抽取（轻量 NER）
//
// 为多个委托相关检查提供统一的实体识别：
//   - A2 (delegate-agent compatibility): instruction 实体 vs profile 实体
//   - B2 (delegate-agent entity binding): subagent 输出必须提及 instruction 实体之一
//   - C2 (quote-verifier grounding): 输出实体必须接地于 instruction/tool_outputs
//   - D1 (draft-extractor redaction): 序列化历史前替换为占位符
//   - D2 (validator profile lint): 阻止具体实体被冻结进 profile 文本
//
// 设计说明（重要）：
//   中文实体抽取在没有词典/分词器的情况下是有损的。本模块用滑动窗口
//   + 双层 stopword 过滤实现"够用"的识别：
//     1) 2-char 窗口 + 直接 stopword 过滤
//     2) 上下文 stopword 过滤：左右相邻 2-char 窗口都是 stopword 时,本窗口
//        视为停用词组合的"中间噪声"丢弃
//     3) 重叠 3-4 char 候选用 50%-stopword 阈值过滤
//   下游使用约定: 全部用"子串包含"匹配,不依赖严格 token 等价。
//
// 允许依赖：（无 — 纯字符串处理）
// 禁止依赖：ipc/* / 任何 IO 模块

export type EntityCategory = 'ticker' | 'stock-code' | 'path' | 'cn-name'

export interface ExtractedEntity {
  /** 原文实体字符串 */
  text: string
  category: EntityCategory
}

// ─── stop-word 列表 ─────────────────────────────────────────────

/**
 * 中文 2 字常用词。命中即视作非实体。
 * 涵盖代词/连词/副词/量词/常用动名词；不含具体专有名词。
 */
const CN_STOPWORDS_2: ReadonlySet<string> = new Set([
  '这是',
  '那是',
  '我们',
  '你们',
  '他们',
  '她们',
  '它们',
  '我的',
  '你的',
  '他的',
  '她的',
  '它的',
  '这个',
  '那个',
  '一个',
  '一些',
  '一种',
  '一样',
  '一直',
  '一定',
  '什么',
  '怎么',
  '为何',
  '因为',
  '所以',
  '但是',
  '不过',
  '然后',
  '于是',
  '现在',
  '过去',
  '已经',
  '正在',
  '将要',
  '还有',
  '没有',
  '可能',
  '必须',
  '应该',
  '需要',
  '可以',
  '不能',
  '不会',
  '帮助',
  '支持',
  '提供',
  '使用',
  '调用',
  '创建',
  '删除',
  '修改',
  '更新',
  '查询',
  '搜索',
  '处理',
  '执行',
  '实现',
  '完成',
  '结束',
  '开始',
  '启动',
  '关闭',
  '停止',
  '运行',
  '失败',
  '成功',
  '错误',
  '正常',
  '异常',
  '正确',
  '系统',
  '程序',
  '文件',
  '目录',
  '路径',
  '配置',
  '参数',
  '命令',
  '输出',
  '输入',
  '返回',
  '显示',
  '工具',
  '数据',
  '信息',
  '内容',
  '结果',
  '问题',
  '方法',
  '时间',
  '时候',
  '股价',
  '股票',
  '走势',
  '分析',
  '今天',
  '明天',
  '昨天',
  '上午',
  '下午',
  '晚上',
  '今年',
  '去年',
  '本周',
  '上周',
  '下周',
  '场景',
  '步骤',
  '环境',
  '版本',
  '请求',
  '响应',
  '消息',
  '事件',
  '类型',
  '名称',
  '默认',
  '示例',
  '规则',
  '协议',
  '编码',
  '解码',
  '格式',
  '语法',
  '语义',
  '逻辑',
  '功能',
  '模块',
  '接口',
  '服务',
  '客户',
  '用户',
  '管理',
  '控制',
  '监控',
  '告警',
  '一首',
  '首诗',
  '写诗',
])

/**
 * 拉丁字母短代号 stop-list。常见技术 / 协议缩写不应被识别为 ticker。
 */
const LATIN_STOPWORDS: ReadonlySet<string> = new Set([
  'HTTP',
  'HTTPS',
  'JSON',
  'XML',
  'YAML',
  'TOML',
  'TODO',
  'FIXME',
  'NOTE',
  'API',
  'URL',
  'URI',
  'CLI',
  'GUI',
  'UI',
  'UX',
  'DB',
  'SQL',
  'MCP',
  'SDK',
  'CSS',
  'HTML',
  'JS',
  'TS',
  'PR',
  'CI',
  'CD',
  'AWS',
  'GCP',
  'AZURE',
  'IO',
  'OS',
  'NPM',
  'PIP',
  'GIT',
  'GO',
  'OK',
  'NO',
  'YES',
  'TRUE',
  'FALSE',
  'NULL',
  'NIL',
  'NONE',
  'ERROR',
  'WARN',
  'INFO',
  'DEBUG',
  'TRACE',
  'FATAL',
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'ID',
  'UUID',
  'GUID',
  'KEY',
  'VAL',
  'ENV',
  'DSML',
  'CSV',
  'PDF',
  'PNG',
  'JPG',
  'GIF',
  'AC',
  'DC',
  'TV',
  'PC',
  'IT',
  'HR',
  'CEO',
  'CTO',
  'CFO',
  'CMO',
  'GDP',
  'SAAS',
  'IAAS',
  'PAAS',
  'IOS',
  'MAC',
])

// ─── regex ──────────────────────────────────────────────────────

/** 大写拉丁字母 2-5 位（股票代码/缩写）。可后接交易所后缀（.SZ/.SH/.HK/.US）。 */
const TICKER_RE = /\b[A-Z]{2,5}(?:\.[A-Z]{2})?\b/g

/** A 股/港股数字代号：6 位数字 + 交易所后缀 */
const STOCK_CODE_RE = /\b\d{6}\.[A-Z]{2}\b/g

/** 绝对路径：以 / 开头，至少含两段 */
const PATH_RE = /\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+/g

/** 中文字符判定 */
function isHan(ch: string): boolean {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return code >= 0x4e00 && code <= 0x9fa5
}

// ─── 公共 API ────────────────────────────────────────────────────

/**
 * 从文本提取候选实体。返回数组按发现顺序排列，相同 (text,category) 仅保留首次。
 *
 * 规则汇总：
 *   ticker:      \b[A-Z]{2,5}(\.[A-Z]{2})?\b 减去 LATIN_STOPWORDS
 *   stock-code:  \b\d{6}\.[A-Z]{2}\b （高优,先匹配避免被 ticker 拆）
 *   path:        以 / 开头并含 ≥1 子段
 *   cn-name:     重叠 2-4 char 滑窗,length-2 受 stopword + 邻窗 stopword 双层过滤,
 *                length-3/4 用 50%-stopword 阈值
 *
 * 重要约定：下游使用必须基于"子串包含"做匹配，不要假设 token 等价。
 */
export function extractEntities(text: string): ExtractedEntity[] {
  if (!text) return []
  const out: ExtractedEntity[] = []
  const seen = new Set<string>()

  function pushIfNew(e: ExtractedEntity): void {
    const key = `${e.category}:${e.text}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(e)
  }

  // 1. stock-code（先匹配，记录区间避免被 ticker 拆分）
  const stockCodeRanges: Array<{ start: number; end: number }> = []
  for (const m of text.matchAll(STOCK_CODE_RE)) {
    if (m.index === undefined) continue
    stockCodeRanges.push({ start: m.index, end: m.index + m[0].length })
    pushIfNew({ text: m[0], category: 'stock-code' })
  }
  function inStockCode(pos: number): boolean {
    return stockCodeRanges.some((r) => pos >= r.start && pos < r.end)
  }

  // 2. ticker
  for (const m of text.matchAll(TICKER_RE)) {
    if (m.index === undefined) continue
    if (inStockCode(m.index)) continue
    const t = m[0]
    const baseTicker = t.includes('.') ? t.split('.')[0] : t
    if (LATIN_STOPWORDS.has(baseTicker)) continue
    pushIfNew({ text: t, category: 'ticker' })
  }

  // 3. path
  for (const m of text.matchAll(PATH_RE)) {
    pushIfNew({ text: m[0], category: 'path' })
  }

  // 4. 中文实体（重叠滑窗）
  // 预计算每个位置的 2-char 窗口 + 是否 stopword。
  const len = text.length
  const winIsStop: boolean[] = new Array(len).fill(false) // winIsStop[i] = (text[i..i+2] is stopword)
  const winIsHan: boolean[] = new Array(len).fill(false)
  for (let i = 0; i + 1 < len; i++) {
    if (isHan(text[i]) && isHan(text[i + 1])) {
      winIsHan[i] = true
      const w = text.slice(i, i + 2)
      if (CN_STOPWORDS_2.has(w)) winIsStop[i] = true
    }
  }

  // 4a. length-2: drop if stopword OR (both neighbor 2-windows are stopword)
  for (let i = 0; i + 1 < len; i++) {
    if (!winIsHan[i]) continue
    if (winIsStop[i]) continue
    const prevStop = i - 1 >= 0 && winIsHan[i - 1] && winIsStop[i - 1]
    const nextStop = i + 1 < len && winIsHan[i + 1] && winIsStop[i + 1]
    if (prevStop && nextStop) continue
    pushIfNew({ text: text.slice(i, i + 2), category: 'cn-name' })
  }

  // 4b. length-3 and length-4: 任一 2-char 子窗口是 stopword → drop
  // 严格规则的取舍: 真实多字实体（"中际旭创"/"阿里巴巴"）通常不含通用停用词组合,
  // 命中即说明此 N-char 横跨了 stopword 边界（如 "搜索百度" 含 "搜索" 是 stop）。
  // 此时丢弃长 N-char,2-char 滑窗仍会单独抽取出真实片段（如 "百度"）。
  for (const L of [3, 4]) {
    for (let i = 0; i + L <= len; i++) {
      let allHan = true
      for (let k = 0; k < L; k++) {
        if (!isHan(text[i + k])) {
          allHan = false
          break
        }
      }
      if (!allHan) continue
      let hasStop = false
      for (let k = 0; k < L - 1; k++) {
        if (winIsStop[i + k]) {
          hasStop = true
          break
        }
      }
      if (hasStop) continue
      pushIfNew({ text: text.slice(i, i + L), category: 'cn-name' })
    }
  }

  return out
}

// v3.7.2: extractEntitySet 已删除 — 仅 delegate_agent A2/B2 使用,A2/B2 已删
// (J-SHOULD-2 反模式)。extractEntities 仍保留供 redactEntities 内部使用。

/**
 * 把文本中的实体替换为类别占位符。同 text 复用同一占位符。
 *
 * 用于 D1 crystallizer 输入侧脱敏。占位符格式：
 *   - cn-name → <COMPANY_A>, <COMPANY_B>, ...
 *   - ticker → <TICKER_A>, <TICKER_B>, ...
 *   - stock-code → <STOCK_CODE_A>, ...
 *   - path → <PATH_1>, <PATH_2>, ...
 *
 * 替换按"先长后短，同长按出现顺序"，避免短串先替换破坏外层匹配。
 * 由于 entity 间存在字符重叠，部分短实体在长实体替换后就不再可见，
 * 不会被实际替换 —— 但仍在 mapping 中分配占位符（debug 完整性）。
 */
export function redactEntities(text: string): {
  redacted: string
  mapping: Record<string, string>
} {
  if (!text) return { redacted: text, mapping: {} }
  const entities = extractEntities(text)
  if (entities.length === 0) return { redacted: text, mapping: {} }

  const counters: Record<EntityCategory, number> = {
    'cn-name': 0,
    ticker: 0,
    'stock-code': 0,
    path: 0,
  }
  const placeholderFor: Record<string, string> = {} // entityText → placeholder
  const mapping: Record<string, string> = {} // placeholder → entityText

  // 长 desc，同长按发现顺序（即 entities 数组顺序，等价于 start asc）
  const sorted = entities
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      const lenDiff = b.e.text.length - a.e.text.length
      if (lenDiff !== 0) return lenDiff
      return a.idx - b.idx
    })
    .map(({ e }) => e)

  for (const e of sorted) {
    if (placeholderFor[e.text]) continue
    counters[e.category] += 1
    const ph = makePlaceholder(e.category, counters[e.category])
    placeholderFor[e.text] = ph
    mapping[ph] = e.text
  }

  let redacted = text
  for (const e of sorted) {
    const ph = placeholderFor[e.text]
    redacted = redacted.split(e.text).join(ph)
  }
  return { redacted, mapping }
}

function makePlaceholder(cat: EntityCategory, idx: number): string {
  const label =
    cat === 'cn-name'
      ? 'COMPANY'
      : cat === 'ticker'
        ? 'TICKER'
        : cat === 'stock-code'
          ? 'STOCK_CODE'
          : 'PATH'
  if (cat === 'path') return `<${label}_${idx}>`
  if (idx <= 26) return `<${label}_${String.fromCharCode(64 + idx)}>` // A=65
  return `<${label}_${idx}>`
}
