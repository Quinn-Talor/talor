// src/main/tools/input-diagnostics.ts — 工具层: 输入校验的诊断消息
//
// 当模型传入错误字段名时(例如 bash 的 `cmd` 应为 `command`),
// 返回信息量大的诊断消息,让模型下一轮能正确修正,而不是盲试字段名。
//
// 两个消费者:
//   - registry.ts 的 validateRequiredFields (schema-level 缺 required)
//   - build-tools.ts 的 buildInputSummary (高风险工具确认前的字段空值检测)
//
// 设计目标:
//   - 告诉模型"缺了什么" + "你实际传了什么" + "期望的 schema 长什么样"
//   - 对拼写/大小写接近的字段提供 "Did you mean <X>?" 建议
//   - 消息长度控制在一条 tool_result 合理范围(< 500 字符)

/**
 * 诊断 input 对象与 tool 的 parameters schema 的不匹配。
 *
 * @param toolName         工具名(用于消息里的定位)
 * @param params           tool.parameters (JSON Schema 片段)
 * @param input            模型实际传入的 input
 * @param missingFields    已经检测出来的缺失字段 (来自 required 数组)
 * @returns                诊断消息字符串
 */
export function diagnoseInputMismatch(
  toolName: string,
  params: {
    type?: string
    required?: string[]
    properties?: Record<string, { type?: string; description?: string }>
  },
  input: unknown,
  missingFields: string[],
): string {
  const inputObj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const providedFields = Object.keys(inputObj)
  const expectedFields = Object.keys(params.properties ?? {})
  const required = params.required ?? []

  const parts: string[] = []

  // 头条:缺失什么
  parts.push(
    `Invalid input for tool "${toolName}": missing required parameter${missingFields.length > 1 ? 's' : ''} [${missingFields.join(', ')}].`,
  )

  // 模型传了什么(尤其重要——日志显示模型常把 command 写成 cmd / args / flags)
  if (providedFields.length > 0) {
    parts.push(`Provided fields: [${providedFields.join(', ')}].`)
  } else {
    parts.push(`Provided fields: (none).`)
  }

  // 期望的 schema (精简,每字段单行)
  if (expectedFields.length > 0) {
    const schemaLines = expectedFields.map(name => {
      const prop = params.properties?.[name]
      const type = prop?.type ?? 'any'
      const req = required.includes(name) ? 'required' : 'optional'
      return `  - ${name} (${type}, ${req})`
    })
    parts.push(`Expected schema:\n${schemaLines.join('\n')}`)
  }

  // Fuzzy 建议:每个缺失字段找 providedFields 里最接近的一个
  for (const missing of missingFields) {
    const suggestion = findClosestField(missing, providedFields)
    if (suggestion) {
      parts.push(`Did you mean "${missing}" instead of "${suggestion}"?`)
    }
  }

  return parts.join('\n')
}

/**
 * 在 candidates 里找与 target 拼写最接近的一个(Levenshtein distance ≤ 3)。
 * 返回最接近的 candidate,或 null。
 *
 * 主要命中场景:
 *   - "command" vs "cmd" (distance 4,边界情况,阈值设 4)
 *   - "content" vs "text" (无匹配)
 *   - "path" vs "file" (无匹配,拒绝虚假建议)
 */
function findClosestField(target: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null
  const targetLower = target.toLowerCase()

  // 优先处理一些已知的别名(模型常犯的错误)
  const aliases: Record<string, string[]> = {
    command: ['cmd', 'shell', 'exec', 'script'],
    content: ['text', 'body', 'data'],
    path: ['file', 'filename', 'filepath'],
    query: ['q', 'search', 'keyword'],
  }
  const knownAliases = aliases[targetLower] ?? []
  for (const candidate of candidates) {
    if (knownAliases.includes(candidate.toLowerCase())) return candidate
  }

  // Fallback: Levenshtein 距离,阈值 max(3, target.length / 2)
  const threshold = Math.max(3, Math.floor(targetLower.length / 2))
  let best: { name: string; dist: number } | null = null
  for (const candidate of candidates) {
    const dist = levenshtein(targetLower, candidate.toLowerCase())
    if (dist <= threshold && (best === null || dist < best.dist)) {
      best = { name: candidate, dist }
    }
  }
  return best?.name ?? null
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const prev: number[] = new Array(b.length + 1)
  const curr: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost, // substitution
      )
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}
