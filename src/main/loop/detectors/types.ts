// src/main/loop/detectors/types.ts —— 业务层: Loop Detector 接口与 verdict
//
// 每个 detector 自治: 自带 state (counter / 上次签名) + 阈值 + reset 条件 + verdict。
// 主循环只调度: 顺序遍历 detectors, 看 verdict.triggered 决定是否 break。
//
// 设计要点:
//   - Verdict 不强制每个 detector 都带 forced summary / markFinal — 由具体 detector 选择
//   - 顺序在主循环显式排列 (signature → failure → tool-only → length-truncation),
//     不靠 priority 数字, 避免"重排 priority 引入意外行为"
//
// 允许依赖: ../outcome-facts, ../types
// 禁止依赖: ipc/*

import type { OutcomeFacts } from '../outcome-facts'
import type { LoopExitReason } from '../types'

/**
 * Detector 观察一步后的"决定"。
 *
 * - triggered=false: 本步检测未触发, 主循环继续
 * - triggered=true:  本步检测触发, 主循环 break (按 exitReason 标注原因)
 *
 * 可选字段:
 *   - runSummary: 触发时先跑一个 forced summary, 再 break
 *   - markFinal:  触发时标记 accumulator.markFinal() (forced summary 已落 final 时使用)
 */
export interface DetectorVerdict {
  triggered: boolean
  exitReason?: LoopExitReason
  runSummary?: () => Promise<void>
  markFinal?: boolean
}

/** 不触发的默认 verdict, 减少各 detector 重复构造。 */
export const NO_TRIGGER: DetectorVerdict = { triggered: false }

/**
 * Loop Detector 接口。
 *
 * 实现要点:
 *   - observe 是唯一 state 入口; 内部维护自己的 counter / 签名等
 *   - nextHint 可选 — 用于在下一步注入 system hint (streak 警告 / 软提示)
 *   - 不强制每个 detector 都有 nextHint
 */
export interface LoopDetector {
  /** 人类可读名, 用于日志 (e.g. 'signature-dead-loop' / 'failure-streak')。 */
  readonly name: string

  /**
   * 观察一步的 facts, 决定是否触发。
   * stepIndex 用于 forced summary 闭包捕获当前步数; 不跑 forced summary 的
   * detector 可忽略此参数。
   * raw 提供 stepText + finishReason 给需要原文/SDK 信号判定的 detector。
   */
  observe(facts: OutcomeFacts, stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict

  /**
   * 返回下一步注入的 system hint, 或 null。
   * 主循环用 composeHint(detectors) 取第一个非空的 hint (按数组顺序)。
   */
  nextHint?(): string | null
}

/**
 * raw 上下文信号 — observe 第三参数。
 *
 * 不放进 OutcomeFacts (OutcomeFacts 是派生信号; raw 是原文) — 把 stepText
 * 这种粗糙信息塞进 facts 会污染其他 detector 的判定。
 * 字段最小化, 仅暴露当前 detector 实际消费的信号, 需要时再加。
 */
export interface DetectorRawContext {
  /** 本步模型纯文本输出 (剔除 tool_use markup)。 */
  stepText: string
  /**
   * SDK finishReason (LLM 自陈停止原因)。
   * 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'
   * 当前仅 LengthTruncationStreakDetector 消费 ('length' 连续 → 死循环)。
   */
  finishReason?: import('ai').FinishReason
}
