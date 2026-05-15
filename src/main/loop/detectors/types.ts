// src/main/loop/detectors/types.ts —— 业务层: Detector 接口 (硬切断侦测)
//
// Detector 专做"代码硬编码判定 → 主循环 break"的故障侦测, 不输出 hint / summary。
// Hint / wrapUp / forced-summary 等反思能力归 Reflector chain (loop/reflect/)。
//
// 混合体 (Detector + Reflector 同实例) 共享内部 state, 分别从两个接口出口:
//   - SignatureDeadLoop: observe → triggered + 设 pendingWrapUp; reflect → wrapUp
//   - LengthTruncationStreak: observe → triggered (chain≥limit); reflect → hint (chain==limit-1)
//
// 允许依赖: ../outcome-facts, ../types
// 禁止依赖: ipc/*

import type { OutcomeFacts } from '../outcome-facts'
import type { LoopExitReason } from '../types'

export interface DetectorVerdict {
  triggered: boolean
  exitReason?: LoopExitReason
}

export const NO_TRIGGER: DetectorVerdict = { triggered: false }

export interface DetectorRawContext {
  /** 本步模型纯文本输出 (剔除 tool_use markup) */
  stepText: string
  /**
   * SDK finishReason (LLM 自陈停止原因)。
   * 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'
   * LengthTruncationStreak 消费 ('length' 连续 → 死循环)。
   */
  finishReason?: import('ai').FinishReason
}

export interface Detector {
  /** 人类可读名, 用于日志。 */
  readonly name: string

  /**
   * 观察一步 facts, 判定是否触发硬切断。
   * stepIndex / raw 由调用方提供; raw 仅 length-truncation 等 SDK 信号判定者消费。
   */
  observe(facts: OutcomeFacts, stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict
}
