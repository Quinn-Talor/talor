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
   * 一条消息落库后触发 (messageRepo.create / createBatch 之后)。
   *
   * 入口层把回调桥接到 `webContents.send('chat:message-persisted', {sessionId,
   * stepIndex})`, renderer 立即 loadMessages。延迟从秒级降到 IPC RTT 量级。
   *
   * stepIndex 语义:
   *   - renderer 用此值清掉 streamItems 中 stepIndex ≤ 该值的项, 避免
   *     "已落库消息" + "流式 log" 同时显示同一步的视觉重复
   *   - forced-summary 等非具体 step 的 persist 用 accumulator 总 step 数
   *
   * subagent 透传: 子 loop 的 persist 也应让父 session UI 看到 — 当前实现
   * 仅透传顶层 sessionId, subagent 落库时也用父 sessionId 触发刷新。
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
 * 基础:
 *   - 'no_tool_calls':     LegacyNaturalFinalPolicy 兜底 — LLM 自然停, 无工具
 *   - 'empty_text':        既无工具调用也无文本
 *   - 'abort':             调用方主动中止
 *   - 'max_steps':         达到步数上限
 *   - 'fallback_summary':  整轮空文本兜底
 *   - 'repeated_error':    死循环 / 失败连击触发
 *   - 'context_overflow':  prompt 估算 >= context_limit, 提交前短路
 *
 * Turn-end policy 决策:
 *   - 'declared_final':         LLM emit done/need_input/blocked block
 *   - 'continuation_injected':  policy 判 continue + 注入 reminder
 *   - 'judge_complete':         JudgeCompletionPolicy 判 COMPLETE
 *   - 'truncated':              SDK finishReason='length' (max_tokens 截断)
 *   - 'content_filter':         SDK finishReason='content-filter'
 *   - 'continuation_chain':     ContinuationChainDetector 防滥用触发
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
   * turn-end policy 决 continue 时携带的 hint, 主 loop 注入到下一步 system message。
   * final 路径 / 工具路径不设此字段。
   *
   * 当前生产者: SdkFinishReasonPolicy ('length' 截断兜底)、JudgeCompletionPolicy。
   */
  injectHint?: string
  /**
   * SDK 报告的本步停止原因 (LLM 自陈)。
   *
   * 用途: detector 链消费 (LengthTruncationStreakDetector 监控连续 'length')。
   * 工具路径恒为 'tool-calls'; 无工具路径走 SDK 实际值。
   */
  finishReason?: import('ai').FinishReason
}
