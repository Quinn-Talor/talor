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
 * 既有 (v3.7):
 *   - 'no_tool_calls':     LegacyNaturalFinalPolicy 兜底 (等价旧 natural FINAL)
 *   - 'empty_text':        既无工具调用也无文本
 *   - 'abort':             调用方主动中止
 *   - 'max_steps':         达到步数上限
 *   - 'fallback_summary':  整轮空文本兜底
 *   - 'repeated_error':    死循环 / 失败连击触发
 *   - 'context_overflow':  prompt 估算 >= context_limit, 提交前短路
 *
 * 新增 (v3.7.3, LLM 自陈 + SDK 信号):
 *   - 'declared_final':         LLM emit done/need_input/blocked block
 *   - 'continuation_injected':  pending_continuation block 或 judge → continue + 注入 reminder
 *   - 'judge_complete':         JudgeCompletionPolicy 判 COMPLETE (PR 2 启用)
 *   - 'truncated':              SDK finishReason='length' (max_tokens 截断)
 *   - 'content_filter':         SDK finishReason='content-filter'
 *   - 'continuation_chain':     ContinuationChainDetector 防滥用触发
 *
 * 历史移除:
 *   - 'no_tool_calls_no_marker' (v3.7) / 'no_marker_max_attempts' (v3.7 forced-closure)
 */
export type LoopExitReason =
  | 'no_tool_calls'
  | 'empty_text'
  | 'abort'
  | 'max_steps'
  | 'fallback_summary'
  | 'repeated_error'
  | 'context_overflow'
  | 'declared_final'
  | 'continuation_injected'
  | 'judge_complete'
  | 'truncated'
  | 'content_filter'
  | 'continuation_chain'

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
  /**
   * v3.7.3: turn-end policy 决定 'continue' 时携带的 hint,主 loop 注入到下一步
   * 的 system message。final 路径 / 工具路径不设此字段。
   *
   * 当前生产者:PendingContinuationBlockPolicy(LLM 主声明)、SdkFinishReasonPolicy
   * (finishReason='length' 截断兜底)、JudgeCompletionPolicy (PR 2)。
   */
  injectHint?: string
  /**
   * v3.7.3: SDK 报告的本步停止原因 (LLM 自陈)。
   *
   * 用途:detector 链消费 (例如 LengthTruncationStreakDetector 监控连续 'length')。
   * 工具路径恒为 'tool-calls';无工具路径走 SDK 实际值。
   */
  finishReason?: import('ai').FinishReason
}
