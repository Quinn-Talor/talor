// src/main/loop/detector-state.ts —— 业务层: detector + react-loop 共享的可变状态 (v4 Phase 3)
//
// 设计动机:
//   v3 主循环里, 各 detector 的"已观察到 N 步"/"该不该 break"等状态在 detector
//   实例内部维护; 主循环遍历 detectors 看 verdict.triggered 即 break。
//
//   v4 用 SDK 内置多步 — onStepFinish 触发时间在 streamText 内, 那时已经没有外层
//   主循环可立刻 break。我们通过共享 DetectorState 把"该不该停"这个信号通过
//   stopWhen 闭包传给 SDK: detector observe 时 set shouldStop=true, stopWhen 函数
//   下一次被 SDK 检查时返 true → SDK 退出多步。
//
//   同时 forced summary 这种"break 后要再调一次 streamText"的副作用不能在
//   onStepFinish 里直接做(会嵌套), 改成 pendingForcedSummary callback 由外层
//   while loop 在 streamText 完成后处理。
//
// 允许依赖: ./types
// 禁止依赖: ipc/*, ai/*

import type { LoopExitReason } from './types'

/**
 * detector + react-loop 共享的可变状态。
 *
 * 字段语义:
 *   - totalSteps:              累计已完成 step 数 (跨 streamText 调用累计)
 *   - shouldStop:              detector 触发"立即停" — stopWhen 闭包读此字段
 *   - exitReason:              shouldStop=true 时的退出原因
 *   - pendingForcedSummary:    detector 触发后要跑的兜底 summary callback
 *   - markFinal:               触发 detector 时是否标记 accumulator final 状态
 *   - lastInputTokens:         上步 SDK 报告的输入 tokens (context 预算用,J-SHOULD-3 类别 B)
 *
 * 生命周期:
 *   - runReactLoop 入口 createDetectorState() 一次
 *   - detector observe / onStepFinish 修改
 *   - stopWhen 闭包读取
 *   - 外层 while loop 检查 shouldStop, 跑 pendingForcedSummary 后 break
 */
export interface DetectorState {
  totalSteps: number
  shouldStop: boolean
  exitReason?: LoopExitReason
  pendingForcedSummary: (() => Promise<void>) | null
  markFinal: boolean
  lastInputTokens?: number
}

export function createDetectorState(): DetectorState {
  return {
    totalSteps: 0,
    shouldStop: false,
    pendingForcedSummary: null,
    markFinal: false,
  }
}
