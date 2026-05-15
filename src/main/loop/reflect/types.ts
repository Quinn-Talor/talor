// src/main/loop/reflect/types.ts —— 业务层: Reflector 接口 + ReflectContext + Outcome
//
// Reflector 是反思的统一入口, 跟 Detector (硬切断) 互补。
// 三个 phase: pre-step / post-step / turn-end, 用 discriminated union 类型守卫保证字段安全。
// Capabilities 元数据驱动主循环调度 (phases 过滤 / maxPerTurn 上限 / priority 排序)。
//
// 三态输出:
//   hint:          pre-step 注入本步 messages; post-step 注入下步 nextPolicyHint
//   wrapUp:        LLM forced-summary 当下产出 + break turn
//   directOutput:  reflect LLM 当下产出 user-facing 内容
//                    endTurn=true  → 落库 + break
//                    endTurn=false → 落库 + 下步通过 history 让 main LLM 看到
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

export interface ReflectorDirectOutput {
  /** reflect LLM 产出的 user-facing 文本 */
  text: string
  /** 落库 label 前缀 (e.g. '[reflection-judge]' / '[reflect-correction]') */
  label: string
  /** 落库后是否结束 turn */
  endTurn: boolean
  /** endTurn=true 时携带 */
  exitReason?: LoopExitReason
  /** 触发原因, 落 ledger + 日志 */
  reason: string
}

export interface ReflectorOutcome {
  hint?: string
  wrapUp?: ReflectorWrapUp
  directOutput?: ReflectorDirectOutput
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
