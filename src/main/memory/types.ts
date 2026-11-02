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

// ── Token 估算（迁到 history/tokens.ts，这里再导出）──────
export {
  estimate,
  MEDIA_PART_TOKENS,
  estimatePartTokens,
  estimateContentTokens,
  estimateModelMessageTokens,
  estimateModelMessagesTokens,
  estimateToolDefinitionsTokens,
  estimateMessage,
} from '../history/tokens'

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
    // 提示消息（content_type 'notice'）只给用户看，不进模型输入
    if (msg.content_type === 'notice') continue
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

export type { SessionSummary } from '../history/session-summary'

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
    config: import('../history/context-config').ProviderContextConfig,
    opts?: MemoryRequestOptions,
  ): Promise<MemoryContext>
}
