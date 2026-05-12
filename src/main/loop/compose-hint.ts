// src/main/loop/compose-hint.ts —— 业务层: 合并多个 detector 的 hint
//
// 主循环每步调一次 composeHint(detectors), 顺着 detectors 数组遍历,
// 返回第一个非空的 hint (优先级 = 数组顺序)。
//
// 设计:
//   - 不组合多个 hint (拼接) — 长 hint 喂给模型反而降低遵循度
//   - 优先级硬编码为 "数组前面优先" — 显式可见, 不靠 priority 数字
//
// 当前优先级 (与 detectors 数组顺序一致):
//   1. failure-streak (最严重: 工具一直失败)
//   2. no-marker-streak (其次: 模型想停但没显式收尾)
//
// 允许依赖: ./detectors/types
// 禁止依赖: ipc/*

import type { LoopDetector } from './detectors/types'

/**
 * 顺序遍历 detectors, 返回第一个非空的 nextHint, 或 null。
 *
 * 主循环示例:
 *   const hint = composeHint(detectors)
 *   const outcome = await runReactStep(ctx, ..., hint)
 */
export function composeHint(detectors: readonly LoopDetector[]): string | null {
  for (const d of detectors) {
    const hint = d.nextHint?.()
    if (hint) return hint
  }
  return null
}
