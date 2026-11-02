// src/main/history/tokens.ts — 业务层(history)：消息与片段的 token 估算
//
// 原样迁自 memory/types.ts（memory/types.ts 再导出），memory 压缩判定、旧路径 loop 上下文预算与
// 引擎路径的跨轮摘要共用这一口径。旧路径与引擎共用，不随旧路径删除。
//
// 允许依赖: ai（类型）、repos/session-repo（类型）
// 禁止依赖: ipc/*、memory/*、prompt/*、loop/*、chat/orchestrator

import type { ModelMessage } from 'ai'
import type { ChatMessage } from '../repos/session-repo'

// ── Token 估算 ──────────────────────────────────────────
const CJK_RE = /[㐀-鿿豈-﫿\u{20000}-\u{2A6DF}]/u

export function estimate(content: string): number {
  if (!content) return 0
  let cjkCount = 0
  for (const ch of content) {
    if (CJK_RE.test(ch)) cjkCount++
  }
  const latinCount = content.length - cjkCount
  // CJK: ~1.5 chars/token → multiply by 0.67; Latin: ~4 chars/token → multiply by 0.25
  return Math.ceil(cjkCount * 0.67 + latinCount * 0.25)
}

/**
 * 单个图片 / 文件 part 的固定 token 数。媒体 part 的 base64 载荷若当文本估算,
 * 一张 1.5MB 截图会被估成数十万 token,压缩判定与上下文预算都会误判超限。
 */
export const MEDIA_PART_TOKENS = 85

/** tool-result `content` 输出里表示媒体的 part 类型(SDK ToolResultOutput content 项)。 */
const MEDIA_OUTPUT_TYPES = new Set([
  'media',
  'image-data',
  'image-url',
  'image-file-id',
  'file-data',
  'file-url',
  'file-id',
])

/** 兜底序列化时剔除的二进制载荷字段,避免 base64 被当文本计。 */
const BINARY_KEYS = new Set(['data', 'image'])

function stringifyWithoutBinary(v: unknown): string {
  try {
    return JSON.stringify(v, (k, val) => (BINARY_KEYS.has(k) ? undefined : val)) ?? ''
  } catch {
    return ''
  }
}

function estimateToolOutput(output: unknown): number {
  if (typeof output === 'string') return estimate(output)
  if (typeof output !== 'object' || output === null) return 0
  const o = output as { type?: unknown; value?: unknown }
  if (o.type === 'content' && Array.isArray(o.value)) {
    let total = 0
    for (const item of o.value as Array<{ type?: unknown; text?: unknown } | null>) {
      if (item && typeof item.type === 'string' && MEDIA_OUTPUT_TYPES.has(item.type)) {
        total += MEDIA_PART_TOKENS
      } else if (item && typeof item.text === 'string') {
        total += estimate(item.text)
      } else {
        total += estimate(stringifyWithoutBinary(item))
      }
    }
    return total
  }
  if (typeof o.value === 'string') return estimate(o.value)
  return estimate(stringifyWithoutBinary(o.value ?? output))
}

/** 单个 content part(SDK ModelMessage content 项或 DB 存储的同构 block)的 token 估算。 */
export function estimatePartTokens(part: unknown): number {
  if (typeof part === 'string') return estimate(part)
  if (typeof part !== 'object' || part === null) return 0
  const p = part as { type?: unknown; text?: unknown; input?: unknown; output?: unknown }
  switch (p.type) {
    case 'text':
    case 'reasoning':
      return typeof p.text === 'string' ? estimate(p.text) : 0
    case 'image':
    case 'file':
    case 'reasoning-file':
      return MEDIA_PART_TOKENS
    case 'tool-call':
      return estimate(JSON.stringify(p.input ?? ''))
    case 'tool-result':
      return estimateToolOutput(p.output)
    default:
      return estimate(stringifyWithoutBinary(part))
  }
}

/**
 * 消息 content(字符串或 part 数组)的 token 估算。memory 压缩判定与 loop 上下文预算
 * 共用这一口径,两侧对同一 prompt 的估算才一致。
 */
export function estimateContentTokens(content: unknown): number {
  if (typeof content === 'string') return estimate(content)
  if (!Array.isArray(content)) return estimate(stringifyWithoutBinary(content))
  let total = 0
  for (const part of content) total += estimatePartTokens(part)
  return total
}

/** 单条 SDK ModelMessage 的 token 估算。 */
export function estimateModelMessageTokens(m: ModelMessage): number {
  return estimateContentTokens(m.content)
}

/** 多条 SDK ModelMessage 的 token 估算之和。 */
export function estimateModelMessagesTokens(messages: readonly ModelMessage[]): number {
  let total = 0
  for (const m of messages) total += estimateModelMessageTokens(m)
  return total
}

/** 工具定义(发给模型的 schema 列表)的 token 估算;空列表为 0。 */
export function estimateToolDefinitionsTokens(tools: readonly unknown[]): number {
  return tools.length > 0 ? estimate(JSON.stringify(tools)) : 0
}

/** DB 消息(content 为 JSON 序列化的 SDK content)的 token 估算。 */
export function estimateMessage(msg: ChatMessage): number {
  let content: unknown
  try {
    content = JSON.parse(msg.content)
  } catch {
    return estimate(msg.content)
  }
  return estimateContentTokens(content)
}
