// src/main/loop/turn-end-policies/types.ts — 业务层: Turn-end Policy 接口
//
// 抽象 react-loop step-end 的决策点 (无 tool call + 有 text 时该 final 还是 continue),
// 引入 Strategy + Chain-of-Responsibility 模式,使未来扩展 turn-end 判断逻辑零修改 react-loop。
//
// 协作模型 (v3.7.3 J-SHOULD-2):
//   - LLM 自陈信号 (finishReason, talor block) → policy 链直接消费 (信任 LLM)
//   - 运行时真相 (usage, providerMetadata) → 系统观测,detector / Ledger 消费
//   - LLM judge 二审 → 调度 LLM 判 LLM,非 regex (兜底)
//
// 设计要点:
//   - 每个 policy 独立模块,可单测,可组合
//   - PolicyContext 把 SDK 信号作为一等参数注入,所有 policy 都能直接消费
//   - decision.action='no-opinion' 让 chain 跳过本 policy,交给下一个
//   - LegacyNaturalFinalPolicy 永远在链末尾兜底 (永不返 no-opinion)
//
// 允许依赖: ../types, ../../agent/agent, ai (类型), shared/talor-blocks/*
// 禁止依赖: ipc/*

import type { FinishReason, LanguageModel, CallWarning } from 'ai'
import type { LoopExitReason, StepOutcome } from '../types'
import type { Agent } from '../../agent/agent'

/**
 * Turn-end policy 的决策三态。
 *
 * - 'final':       break loop,本 turn 结束 (FINAL),携带 exitReason
 * - 'continue':    继续 loop,可携带 injectHint 注入到下一步的 system message
 * - 'no-opinion':  本 policy 不处理这种 case,交给链上下一个 policy
 *
 * 链组装时第一个非 'no-opinion' 的 decision wins。
 * 链末尾必须有"永远不返 no-opinion"的兜底 policy (LegacyNaturalFinalPolicy)。
 */
export interface TurnEndDecision {
  action: 'final' | 'continue' | 'no-opinion'
  /** action='final' 或 'continue' 时携带,'no-opinion' 不携带 */
  exitReason?: LoopExitReason
  /** action='continue' 时注入到下一步 system message 的 hint */
  injectHint?: string
  /** 日志 / 审计用,描述决策来由 */
  reason: string
}

/**
 * 传递给 policy 的上下文。
 *
 * SDK 信号 (sdkSignals) 是一等参数 — 按 v3.7.3 J-SHOULD-3 协作原则,SDK 给的
 * 结构化信号是 policy 链直接消费的素材,不再用启发式重新推断。
 */
export interface PolicyContext {
  agent: Agent
  sessionId: string
  stepIndex: number
  abortSignal: AbortSignal

  /**
   * SDK 给的 LLM 自陈信号 + 运行时真相 (v3.7.3 一等公民化)。
   *
   * 类别 A (LLM 自陈): finishReason
   * 类别 B (运行时真相): usage, providerMetadata, warnings
   */
  sdkSignals: {
    /** SDK FinishReason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other' | 'unknown' */
    finishReason: FinishReason
    /** Provider 测得的精确 token 用量,缺失时为 undefined (某些 provider 不报) */
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    /** Provider 特定 metadata,如 Anthropic cacheReadInputTokens */
    providerMetadata?: Record<string, unknown>
    /** Provider 警告列表,如 "tool_choice ignored",入 Ledger 观测用 */
    warnings?: CallWarning[]
  }

  /**
   * Judge call 用的 model factory (JudgeCompletionPolicy 才需要,PR 2 启用)。
   * 工厂模式而非直接 model 实例: judge model 可能与主对话 model 不同,
   * 用 factory 让 policy 在需要时再 resolve,避免 PR 1 不用 judge 时也强制初始化。
   */
  judgeProvider?: () => Promise<LanguageModel>
}

/**
 * Turn-end policy 接口。
 *
 * 实现要点:
 *   - evaluate 只接 StepOutcome + PolicyContext,不接 raw text (parseTalorBlocks 在 policy 内调用)
 *   - 异步签名: judge policy 需要 await LLM 调用;其他 policy 用同步返 Promise.resolve 也 OK
 *   - 失败时返 'no-opinion' (fail-open),让链上后续 policy 兜底
 */
export interface TurnEndPolicy {
  /** 人类可读名,用于日志 (e.g. 'sdk-finish-reason') */
  readonly name: string

  evaluate(outcome: StepOutcome, ctx: PolicyContext): Promise<TurnEndDecision>
}

/** 不处理的默认决策,policy fail-open 用。 */
export const NO_OPINION: TurnEndDecision = {
  action: 'no-opinion',
  reason: 'default no-opinion',
}
