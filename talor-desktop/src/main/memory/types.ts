import type { CoreMessage } from 'ai'
import type { ChatMessage } from '../repos/session-repo'

// ── Token 估算 ──────────────────────────────────────────
export function estimate(content: string): number {
  return Math.ceil(content.length / 3)
}

export function estimateMessage(msg: ChatMessage): number {
  try {
    const blocks = JSON.parse(msg.content) as Array<{ type: string; text?: string }>
    const text = blocks
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('')
    const imageCount = blocks.filter(b => b.type === 'image').length
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

// ── CoreMessage 转换 ────────────────────────────────────
// 将 ChatMessage[] 转为 CoreMessage[]，逻辑与 chat.ts toCoreMessages() 相同
// 但接受消息数组而非从 DB 重新查询，供 ShortTermMemory recent 区使用
export function messagesToCoreMessages(messages: ChatMessage[]): CoreMessage[] {
  const TOOL_RESULT_FULL_WINDOW = 4
  const toolRowIndices: number[] = []
  messages.forEach((m, i) => { if (m.role === 'tool') toolRowIndices.push(i) })
  const oldToolIndices = new Set(
    toolRowIndices.slice(0, Math.max(0, toolRowIndices.length - TOOL_RESULT_FULL_WINDOW))
  )

  const result: CoreMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    let blocks: Array<{ type: string; [k: string]: unknown }>
    try {
      blocks = JSON.parse(msg.content)
    } catch {
      blocks = [{ type: 'text', text: msg.content }]
    }

    if (msg.role === 'system') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text as string).join('\n')
      result.push({ role: 'system', content: text })
    } else if (msg.role === 'user') {
      const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = []
      for (const b of blocks) {
        if (b.type === 'text') parts.push({ type: 'text', text: b.text as string })
        else if (b.type === 'image') parts.push({ type: 'image', image: b.image as string })
      }
      result.push({ role: 'user', content: parts.length > 0 ? parts : '' } as CoreMessage)
    } else if (msg.role === 'assistant') {
      const parts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }> = []
      for (const b of blocks) {
        if (b.type === 'text') parts.push({ type: 'text', text: b.text as string })
        else if (b.type === 'tool_use') parts.push({ type: 'tool-call', toolCallId: b.toolCallId as string, toolName: b.toolName as string, args: b.input })
      }
      result.push({ role: 'assistant', content: parts } as CoreMessage)
    } else if (msg.role === 'tool') {
      const isOld = oldToolIndices.has(i)
      const parts: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'text'; value: string } }> = []
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const value = isOld
            ? `[已省略旧结果，工具=${b.toolName as string}，长度=${(b.output as string).length}字符]`
            : b.output as string
          parts.push({ type: 'tool-result', toolCallId: b.toolCallId as string, toolName: b.toolName as string, output: { type: 'text', value } })
        }
      }
      result.push({ role: 'tool', content: parts } as unknown as CoreMessage)
    }
  }
  return result
}

// ── 共享类型 ────────────────────────────────────────────
export interface MemoryContext {
  summaryMessage: CoreMessage | null
  recentMessages: CoreMessage[]
  tokenEstimate: number
}

export interface SessionSummary {
  session_id: string
  summary_text: string
  covered_until: string   // messages.id（TEXT UUID）
  token_estimate: number
  created_at: string      // ISO 8601
}

export interface MemoryModule {
  getContext(sessionId: string, config: import('../prompt/types').ProviderContextConfig): Promise<MemoryContext>
}
