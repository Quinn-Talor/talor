// src/main/loop/types.ts
import type { LanguageModel } from 'ai'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'
import type { SkillActivationTracker } from '../skills/registry'
import type { ExecutionEventBus } from '../chat/events'

export interface ReactLoopCallbacks {
  onTextDelta: (delta: string, stepIndex: number) => void
  onToolCall: (
    toolCallId: string,
    toolName: string,
    input: unknown,
    stepIndex: number,
    startedAt: number,
  ) => void
  onToolResult: (toolCallId: string, toolName: string, output: unknown, durationMs: number) => void
}

export interface ReactLoopOptions {
  model: LanguageModel
  sessionId: string
  messageId: string
  userContent: string
  mappedAttachments: Array<{
    name: string
    mediaType: string
    base64?: string
    content?: undefined
  }>
  abortSignal: AbortSignal
  pipeline: PromptPipeline
  provider: Provider
  providerConfig: ProviderContextConfig
  workspace: string
  callbacks: ReactLoopCallbacks
  maxSteps?: number
  agent: import('../agent/agent').Agent
  confirmTool: import('../ipc/tool-confirm').ToolConfirmPort
  /** Workspace-external access consent (PR #4). Optional for backward compat. */
  requestPermission?: import('../tools/types').PermissionPort
  /** Per-session skill activation tracker shared between skill-tool and AgentPromptPlugin. */
  skillTracker: SkillActivationTracker
  /** Per-execution event bus for internal state-change notifications. */
  events: ExecutionEventBus
  /** Provider-specific options passed to streamText (e.g. providerOptions). */
  streamOptions?: Record<string, unknown>
}

/**
 * 循环终止原因枚举。
 *
 * - 'no_tool_calls':              模型无 tool + 有 Rule 13 marker(正常 final 终态)
 * - 'no_tool_calls_no_marker':    内部信号: 无 tool 且无 marker → 主循环看到后判定继续 vs forced closure
 * - 'no_marker_max_attempts':     连续 NO_MARKER_LIMIT 次无 marker → forced closure 触发
 * - 'empty_text':                 既无工具调用也无文本(走 fallback summary)
 * - 'abort':                      调用方主动中止
 * - 'max_steps':                  达到步数上限
 * - 'fallback_summary':           整轮空文本兜底
 * - 'repeated_error':             死循环 / 失败连击触发
 * - 'tool_only_loop':             连续 N 步有工具调用但零文本输出
 * - 'context_overflow':           prompt 估算 >= context_limit, 提交前短路
 */
export type LoopExitReason =
  | 'no_tool_calls'
  | 'no_tool_calls_no_marker'
  | 'no_marker_max_attempts'
  | 'empty_text'
  | 'abort'
  | 'max_steps'
  | 'fallback_summary'
  | 'repeated_error'
  | 'tool_only_loop'
  | 'context_overflow'

/**
 * 单步 ReAct 的结果, 由 runReactStep 返回给主循环。
 *
 * 字段语义：
 * - stepText:               本步纯文本输出累计(剔除 tool_use markup)
 * - wroteAssistantFinal:    是否已落最终 assistant 消息(id===ctx.messageId)
 * - shouldContinue:         主循环是否应继续下一步; false → break
 * - durationMs:             本步耗时
 * - toolNames:              本步实际调用的工具名列表(可重复)
 * - exitReason:             仅当 shouldContinue=false 时携带; 也可在 shouldContinue=true 时
 *                           携带 'no_tool_calls_no_marker' 作为信号
 * - signature:              本步复合签名(tool#inputHash:outputHash sorted join)
 * - allToolsFailed:         三态; null=无工具调用, true=全失败, false=至少一成功
 * - containsSubagentFailure: 是否含 SUBAGENT_/DELEGATION_ 前缀的错误 envelope
 */
export interface StepOutcome {
  stepText: string
  wroteAssistantFinal: boolean
  shouldContinue: boolean
  durationMs: number
  toolNames: string[]
  exitReason?: LoopExitReason
  signature: string
  allToolsFailed: boolean | null
  containsSubagentFailure: boolean
}
