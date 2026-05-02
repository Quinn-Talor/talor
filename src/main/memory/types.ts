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

export function estimateMessage(msg: ChatMessage): number {
  try {
    const content = JSON.parse(msg.content)
    if (typeof content === 'string') return estimate(content)
    if (!Array.isArray(content)) return estimate(msg.content)
    const parts = content as Array<{
      type: string
      text?: string
      input?: unknown
      output?: unknown
    }>
    let text = ''
    let imageCount = 0
    for (const p of parts) {
      if (p.type === 'text' || p.type === 'reasoning') text += p.text ?? ''
      else if (p.type === 'image') imageCount++
      else if (p.type === 'tool-call') text += JSON.stringify(p.input ?? '')
      else if (p.type === 'tool-result') {
        const out = p.output as { value?: string } | string | undefined
        text += typeof out === 'string' ? out : ((out as { value?: string })?.value ?? '')
      }
    }
    return estimate(text) + imageCount * 85
  } catch {
    return estimate(msg.content)
  }
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

export interface MemoryModule {
  getContext(
    sessionId: string,
    config: import('../prompt/types').ProviderContextConfig,
  ): Promise<MemoryContext>
}
