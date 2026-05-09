// src/main/prompt/naturalize.ts — 业务层：AcceptanceCriterion → 自然语言渲染
//
// 把结构化的 acceptance criterion 转成 LLM 易读的自然语言句子，渲染到 prompt。
// 支持 implicit acceptance(_implicit + _knowledgePath)的特殊文案。
//
// 允许依赖: shared/types
// 禁止依赖: ipc/*

import type { AcceptanceCriterion } from '@shared/types/agent'

export function naturalize(c: AcceptanceCriterion): string {
  switch (c.type) {
    case 'deliverable-present':
      if (c._implicit && c._knowledgePath) {
        return `You read "${c._knowledgePath}" at least once`
      }
      return `A "${c.deliverableId}" block is present in your final output`
    case 'tool-was-used':
      if (c._implicit && c._knowledgePath) {
        return `You read "${c._knowledgePath}" at least once`
      }
      return `You called the "${c.toolName}" tool at least once`
    case 'tool-not-used':
      return `You did NOT call the "${c.toolName}" tool`
    case 'tool-not-failed':
      return `Your "${c.toolName}" calls all succeeded`
    case 'output-matches':
      if (c.schema) return `Your output JSON matches the required schema`
      if (c.pattern) return `Your output contains the pattern "${c.pattern}"`
      return `Your output matches the required format`
    case 'verifier-tool':
      return `The "${c.toolName}" verifier passes`
    case 'llm-judge':
      return `An independent reviewer agrees the output is acceptable`
    case 'human-approval':
      return `A human reviewer (${c.approverRef}) approves`
  }
}

/** 把 AcceptanceCriterion[] 转一组自然语言短句, 用 sep 连接。供 helper joinNaturalize 使用 */
export function joinNaturalize(criteria: AcceptanceCriterion[], sep = ' AND '): string {
  return criteria.map(naturalize).join(sep)
}

/** JSON Schema 简化为自然语言 bullet list 供 LLM 看 */
export function schemaToBullets(schema: unknown, indent = 0): string {
  if (!schema || typeof schema !== 'object') return ''
  const s = schema as Record<string, unknown>
  const pad = '  '.repeat(indent)
  const lines: string[] = []
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const required = (Array.isArray(s.required) ? s.required : []) as string[]
    for (const [key, propRaw] of Object.entries(s.properties as Record<string, unknown>)) {
      const prop = (propRaw ?? {}) as Record<string, unknown>
      const isReq = required.includes(key)
      const ty = String(prop.type ?? prop.const ?? 'any')
      const desc = typeof prop.description === 'string' ? ` — ${prop.description}` : ''
      lines.push(
        `${pad}- ${key} (${ty}${isReq ? ', REQUIRED' : ''}${desc.length > 0 ? '' : ''})${desc}`,
      )
      if (prop.type === 'object' && prop.properties) {
        lines.push(schemaToBullets(prop, indent + 1))
      }
      if (prop.type === 'array' && (prop as Record<string, unknown>).items) {
        lines.push(`${pad}  items:`)
        lines.push(schemaToBullets((prop as Record<string, unknown>).items, indent + 2))
      }
    }
  } else if (s.type) {
    lines.push(`${pad}- ${String(s.type)}`)
  }
  return lines.filter((l) => l.length > 0).join('\n')
}
