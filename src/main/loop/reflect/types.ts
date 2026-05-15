// src/main/loop/reflect/types.ts —— 业务层: Reflector 接口 + ReflectContext + Outcome
//
// Reflector 是反思的统一入口, 跟 Detector (硬切断) 互补。
// 三个 phase: pre-step / post-step / turn-end, 用 discriminated union 类型守卫保证字段安全。
// Capabilities 元数据驱动主循环调度 (phases 过滤 / maxPerTurn 上限 / priority 排序)。
//
// 四态输出 (按 "谁来看 + 是否结束 turn" 区分):
//   hint:          内部引导 (临时) — 注入下一步 messages, 不落库, UI 不渲染
//   internalNudge: 内部引导 (持久化) — 落库为 user role, UI 不渲染, 主 LLM 续做
//   userOutput:    用户回复 — 落库为 assistant role + 触发 UI 流式渲染, 必定结束 turn
//   wrapUp:        用户回复 (forced-summary) — 第三方 LLM 产出 + break turn
//
// 设计原则: reflect 的"用途"决定持久化方式和 UI 行为, 不能混同一个 directOutput 字段。
// JudgeCompletion 这种"主 LLM 内部纠正"不应该作为 user-facing 消息展示。
//
// 允许依赖: ../outcome-facts, ../types, ../detectors/types, ai (类型)
// 禁止依赖: ipc/*

import type { LanguageModel, ModelMessage } from 'ai'
import type { OutcomeFacts } from '../outcome-facts'
import type { StepOutcome, LoopExitReason } from '../types'
import type { DetectorRawContext } from '../detectors/types'

export type ReflectPhase = 'pre-step' | 'post-step' | 'turn-end'

interface CommonFields {
  phase: ReflectPhase
  stepIndex: number
  userIntent: string
  sessionId: string
  abortSignal: AbortSignal
  recentHistory: readonly StepOutcome[]
  /** 反思用 model (沿用主对话 model)。L1 / 不需要 LLM 的 reflector 忽略。 */
  reflectModel: LanguageModel
}

export type ReflectContext =
  | (CommonFields & {
      phase: 'pre-step'
      estimatedTokens: number
      contextLimit: number
      messages: ReadonlyArray<ModelMessage>
    })
  | (CommonFields & {
      phase: 'post-step'
      facts: OutcomeFacts
      outcome: StepOutcome
      raw: DetectorRawContext
    })
  | (CommonFields & {
      phase: 'turn-end'
      facts: OutcomeFacts
      outcome: StepOutcome
      raw: DetectorRawContext
      policyDecision: 'final'
    })

export interface ReflectorWrapUp {
  exitReason: LoopExitReason
  runSummary: () => Promise<void>
  markFinal?: boolean
}

/**
 * 内部引导 (持久化) — 给主 LLM 在下一步读 history 看到, UI 不渲染。
 *
 * 用途: 系统对主 LLM 的内部纠正 (e.g. JudgeCompletion 推翻 final),
 * 不希望以"AI 自己拆穿自己"的形态呈现给用户。
 *
 * - role: 主 LLM 读 history 时的视角. 'user' 最符合 instruct-following 训练分布,
 *   主 LLM 把它当作"外部审查反馈"自然续做; 'system' 适合规则性提示。
 * - 必定 continue loop (不能 endTurn), 否则用户会看不到任何回复。
 */
export interface InternalNudge {
  text: string
  label: string
  reason: string
  role: 'user' | 'system'
}

/**
 * 用户回复 — 落库为 assistant 消息 + 触发 UI 流式渲染, 必定结束 turn。
 *
 * 用途: reflect 决定替换 / 终结主 LLM 的本 turn 输出, 直接展示给用户
 * (e.g. context-overflow 友好 halt, quote-correction 重写后的 final)。
 */
export interface UserOutput {
  text: string
  label: string
  exitReason?: LoopExitReason
  reason: string
}

export interface ReflectorOutcome {
  hint?: string
  internalNudge?: InternalNudge
  userOutput?: UserOutput
  wrapUp?: ReflectorWrapUp
}

export interface ReflectorCapabilities {
  /** 哪些 phase 触发本 reflector */
  phases: ReadonlyArray<ReflectPhase>
  /** 每 turn 触发上限 */
  maxPerTurn?: number
  /** chain 内排序 (数字小先跑), 默认 100 */
  priority?: number
}

export interface Reflector {
  readonly name: string
  readonly capabilities: ReflectorCapabilities
  reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null>
}

/** 用于 L2 LLM reflect 的轨迹快照 */
export interface ReflectionSnapshot {
  userIntent: string
  trajectory: string
  totalSteps: number
  toolStats: { failures: number; total: number }
}

/** 通用 LLM reflect 输出结构 (periodic / escalation 用) */
export interface Reflection {
  progressSoFar: string
  blockerIdentified: string | null
  strategyShift: 'continue' | 'switch_tool' | 'parallelize' | 'ask_user' | 'wrap_up'
  nextStepGuidance: string
  confidence: number
}
