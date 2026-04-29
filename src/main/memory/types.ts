import type { CoreMessage } from 'ai'
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

export function estimateMessage(msg: ChatMessage): number {
  try {
    const blocks = JSON.parse(msg.content) as Array<{ type: string; text?: string }>
    const text = blocks
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('')
    const imageCount = blocks.filter(b => b.type === 'image').length
    const toolResultText = blocks
      .filter(b => b.type === 'tool_result')
      .map(b => (b as unknown as { output: string }).output ?? '')
      .join('')
    const toolUseText = blocks
      .filter(b => b.type === 'tool_use')
      .map(b => JSON.stringify((b as unknown as { input: unknown }).input ?? ''))
      .join('')
    return estimate(text + toolResultText + toolUseText) + imageCount * 85
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
//
// 历史备注：这里曾有一个 TOOL_RESULT_FULL_WINDOW=4 的滑动窗口，把更早的
// tool_result 替换为 [Old tool_result elided ...] 占位符。它与后续引入的
// ShortTermMemory Path A/B 压缩机制构成双重压缩——Path A 下总量远未超阈值
// 也会触发 elide，导致 skill 指令内容（~4KB）在 5 次工具调用后从 prompt 里
// 消失；叠加 SkillActivationTracker 拒绝重复激活，形成死循环。
// 移除后：单条 tool_result 仍由 MAX_TOOL_RESULT_BYTES(8KB) / MAX_SKILL_RESULT_BYTES(1MB)
// 上限守住；总量溢出由 Path B 的 summary + anchors 负责。两层机制已足够。
export function messagesToCoreMessages(messages: ChatMessage[]): CoreMessage[] {
  const result: CoreMessage[] = []
  for (const msg of messages) {
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
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; image: string }
        | { type: 'file'; data: string; mediaType: string }
      > = []
      for (const b of blocks) {
        if (b.type === 'text') {
          parts.push({ type: 'text', text: b.text as string })
        } else if (b.type === 'image') {
          parts.push({ type: 'image', image: b.image as string })
        } else if (b.type === 'file') {
          // ⚠️ 历史 bug：旧实现写 `data: 'File: ${filename}'` 字面字符串，模型根本看不到附件内容。
          // 现在按 textContent / base64Data / path 三路分派：
          //   - 文本文档：直接作为 text block 注入，模型可见
          //   - PDF 等：走 AI SDK 的 file part
          //   - 都没有（旧 session 的 file block）：显式提示用 read 工具读取，避免静默失效
          const filename = b.filename as string
          const mimeType = b.mimeType as string
          const textContent = b.textContent as string | undefined
          const base64Data = b.base64Data as string | undefined
          const path = b.path as string | undefined

          if (textContent !== undefined) {
            parts.push({
              type: 'text',
              text: `[Attachment ${filename} · ${mimeType}]\n${textContent}\n[End of attachment ${filename}]`,
            })
          } else if (base64Data) {
            parts.push({ type: 'file', data: base64Data, mediaType: mimeType })
          } else {
            parts.push({
              type: 'text',
              text: `[Attachment ${filename} · ${mimeType}${path ? ` · path: ${path}` : ''} · use the read tool to load its contents]`,
            })
          }
        }
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
      const parts: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'text'; value: string } }> = []
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          parts.push({
            type: 'tool-result',
            toolCallId: b.toolCallId as string,
            toolName: b.toolName as string,
            output: { type: 'text', value: b.output as string },
          })
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
