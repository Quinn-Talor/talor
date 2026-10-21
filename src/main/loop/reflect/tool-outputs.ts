// src/main/loop/reflect/tool-outputs.ts —— 业务层: 从 session history 抽取最近 tool result
//
// quote-correction (turn-end reflector) 与 forced-summary (兜底摘要) 的引用校验语料来源。
// 从后往前扫 session messages, 取 role='tool' 的 content 中 tool result 的输出文本。
//
// DB 里 tool 消息存 SDK ToolContent 原生格式:
//   { type: 'tool-result', output: { type: 'text', value } }
// 同时兼容早期 Anthropic 风格 block { type: 'tool_result', output: string }, 老 session 仍可校验。
//
// 允许依赖: ../../repos/session-repo
// 禁止依赖: ipc/*

import { messageRepo } from '../../repos/session-repo'

/** 单个 tool content block → 输出文本; 非 tool result block 或无文本返回 null。 */
export function toolResultBlockText(block: unknown): string | null {
  if (typeof block !== 'object' || block === null) return null
  const b = block as { type?: unknown; output?: unknown }
  if (b.type === 'tool_result') {
    return typeof b.output === 'string' && b.output.length > 0 ? b.output : null
  }
  if (b.type !== 'tool-result') return null
  const out = b.output
  if (typeof out === 'string') return out.length > 0 ? out : null
  if (typeof out === 'object' && out !== null && 'value' in out) {
    const v = (out as { value: unknown }).value
    const text = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v)
    return text.length > 0 ? text : null
  }
  return null
}

/**
 * 收集最近 k 条 tool result 的输出文本, 供 verifyQuotedFacts 比对。
 *
 * 从后往前扫: 最相关的证据是"刚跑过的工具"; 取满 k 条即停, 避免对长 session 全量解析。
 */
export function collectRecentToolOutputs(sessionId: string, k: number): string[] {
  const all = messageRepo.listBySession(sessionId)
  const outputs: string[] = []
  for (let i = all.length - 1; i >= 0 && outputs.length < k; i--) {
    if (all[i].role !== 'tool') continue
    let blocks: unknown
    try {
      blocks = JSON.parse(all[i].content)
    } catch {
      continue
    }
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      const text = toolResultBlockText(b)
      if (text === null) continue
      outputs.push(text)
      if (outputs.length >= k) break
    }
  }
  return outputs
}
