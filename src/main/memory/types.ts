import type { ModelMessage } from 'ai'
import type { ChatMessage } from '../repos/session-repo'
import { buildToolResultGuide } from '../tools/tool-result-template'

/**
 * 给 LLM 看的 tool_result 值:结构化指引 + raw 内容。
 * DB 只存 raw output,只在 rebuild prompt 时动态拼接指引。
 */
function injectToolResultGuide(toolName: string, rawOutput: string): string {
  const guide = buildToolResultGuide(toolName)
  const openTagMatch = rawOutput.match(/^(<tool_output[^>]*>\n)/)
  if (!openTagMatch) {
    return `${guide}\n\n---\n\n[Raw output]\n${rawOutput}`
  }
  const openTag = openTagMatch[1]
  const rest = rawOutput.slice(openTag.length)
  return `${openTag}${guide}\n\n---\n\n[Raw output]\n${rest}`
}

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

// ── JSON 提取 ───────────────────────────────────────────
export function extractJsonArray(text: string): string[] {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenceMatch ? fenceMatch[1].trim() : text.trim()
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('Expected JSON array')
  return parsed as string[]
}

// ── DB → SDK ModelMessage 转换 ─────────────────────────────
//
// DB 直接存 SDK 原生 content 格式（AssistantContent / UserContent / ToolContent）。
// rebuild prompt 时 JSON.parse 后直接透传给 SDK，唯一的动态处理是为 tool result
// 注入结构化指引（guide），帮助模型理解工具输出。

export function dbToModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  for (const msg of messages) {
    let content: unknown
    try {
      content = JSON.parse(msg.content)
    } catch {
      content = msg.content
    }

    if (msg.role === 'system') {
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? (content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === 'text')
                .map((b) => b.text ?? '')
                .join('\n')
            : String(content)
      result.push({ role: 'system', content: text })
    } else if (msg.role === 'tool') {
      const parts = content as Array<{
        type: string
        toolName?: string
        output?: { type: string; value: string }
        [k: string]: unknown
      }>
      result.push({
        role: 'tool',
        content: parts.map((p) => {
          if (p.type === 'tool-result' && p.output?.type === 'text') {
            const guided = injectToolResultGuide(p.toolName ?? '', p.output.value)
            return { ...p, output: { ...p.output, value: guided } }
          }
          return p
        }),
      } as ModelMessage)
    } else {
      // user / assistant — 直接透传 SDK 格式
      result.push({ role: msg.role as 'user' | 'assistant', content } as ModelMessage)
    }
  }
  return result
}

// 保留旧名称作为别名，供尚未迁移的调用方使用
export const messagesToCoreMessages = dbToModelMessages as (
  messages: ChatMessage[],
) => ModelMessage[]

// ── 共享类型 ────────────────────────────────────────────
export interface MemoryContext {
  summaryMessage: ModelMessage | null
  recentMessages: ModelMessage[]
  tokenEstimate: number
}

export interface SessionSummary {
  session_id: string
  summary_text: string
  covered_until: string // messages.id（TEXT UUID）
  token_estimate: number
  created_at: string // ISO 8601
}

/**
 * 单次 getContext 的调用期参数(随 prompt 构建变化,不属于 provider 配置)。
 */
export interface MemoryRequestOptions {
  /** 执行事件总线;生成新摘要时 emit 'memory.compressed'。 */
  events?: import('../chat/events').ExecutionEventBus
  /**
   * 与 history 同处一次 prompt 的固定开销估算(system / agent / 工具定义等稳定前缀)。
   * 压缩阈值按 history + 固定开销判定,保证压缩先于上下文溢出 halt 发生。
   */
  fixedOverheadTokens?: number
  /** 本轮请求的中止信号;压缩摘要调用随用户停止一并中止。 */
  abortSignal?: AbortSignal
}

export interface MemoryModule {
  getContext(
    sessionId: string,
    config: import('../prompt/types').ProviderContextConfig,
    opts?: MemoryRequestOptions,
  ): Promise<MemoryContext>
}
