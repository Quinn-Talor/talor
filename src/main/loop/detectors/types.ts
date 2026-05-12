// src/main/loop/detectors/types.ts —— 业务层: Loop Detector 接口与 verdict
//
// 每个 detector 自治: 自带 state (counter / 上次签名 etc) + 阈值 + reset 条件 + 触发 verdict。
// 主循环只调度: 顺序遍历 detectors, 看 verdict.triggered 决定是否 break。
//
// 设计要点:
//   - Verdict 不强制每个 detector 都有 forced summary 或 markFinal —— 由具体业务决定
//   - 顺序在主循环显式排列 (signature → failure → tool-only → no-marker), 不靠 priority 数字
//     避免"重排 priority 引入意外行为"
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
 *   - observe 是唯一的 state 入口; 内部维护自己的 counter / 签名等
 *   - nextHint (可选) 用于在下一步注入 system hint (如 streak 警告 / marker 提示)
 *   - 不强制每个 detector 都有 nextHint
 */
export interface LoopDetector {
  /** 用于日志的人类可读名 (e.g. 'signature-dead-loop' / 'failure-streak') */
  readonly name: string

  /**
   * 观察一步的 facts, 决定是否触发。
   * stepIndex 用于 forced summary 闭包内捕获当前步数; 不需要 forced summary 的
   * detector (signature / tool-only) 可省略此参数。
   */
  observe(facts: OutcomeFacts, stepIndex?: number): DetectorVerdict

  /**
   * 返回给"下一步"注入的 system hint, 或 null。
   * 主循环用 composeHint(detectors) 取第一个非空的 hint (按 detectors 数组顺序)。
   */
  nextHint?(): string | null
}
