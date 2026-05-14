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
  /**
   * v3.6: 一条消息落库后触发(messageRepo.create / createBatch 之后)。
   *
   * 用途: 替代 renderer 端的 3s polling — 入口层把这个回调桥接到
   * `webContents.send('chat:message-persisted', { sessionId, stepIndex })`,
   * 前端收到事件立即调 loadMessages,延迟从秒级降到 IPC RTT 量级 (<50ms)。
   *
   * stepIndex 设计 (v3.6 dedupe fix):
   *   - renderer 拿到这个值后, 清掉 streamItems 中 stepIndex <= 该值的项,
   *     避免"已落库 message 的 ToolCallMessage" 与 "streamItems 的 ToolCallLog"
   *     同时显示同一步工具调用列表 (1:1 视觉重复)
   *   - forced-summary 等非具体 step 的 persist 用 react-loop 的 accumulator
   *     总 step 数, 仍能正确划界
   *
   * 设计:
   *   - 不带 message 内容 — 只通知"有新消息了 + 边界在哪",renderer 自行 loadMessages
   *   - 兼容旧调用方: 可选回调,缺省即退化为 polling 路径
   *   - subagent 透传: 子 loop 的 persist 也应该让父 session UI 知道。
   *     V1 只透传顶层 sessionId — subagent 落库时也用父 sessionId 触发刷新。
   */
  onMessagePersisted?: (sessionId: string, stepIndex: number) => void
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
 * - 'no_tool_calls':     模型无 tool 调用 → 自然 final 终态 (v3.7 后所有"无 tool"都走这条)
 * - 'empty_text':        既无工具调用也无文本(走 fallback summary)
 * - 'abort':             调用方主动中止
 * - 'max_steps':         达到步数上限
 * - 'fallback_summary':  整轮空文本兜底
 * - 'repeated_error':    死循环 / 失败连击触发
 * - 'tool_only_loop':    连续 N 步有工具调用但零文本输出
 * - 'context_overflow':  prompt 估算 >= context_limit, 提交前短路
 *
 * v3.7 移除:
 *   - 'no_tool_calls_no_marker': 旧版"无 marker"内部信号, 现已合并到 'no_tool_calls'
 *   - 'no_marker_max_attempts':  旧版 forced-closure 触发原因, 整路径删除
 */
export type LoopExitReason =
  | 'no_tool_calls'
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
 * - exitReason:             仅当 shouldContinue=false 时携带
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
