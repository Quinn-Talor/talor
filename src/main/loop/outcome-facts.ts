// src/main/loop/outcome-facts.ts —— 业务层: 派生 outcome 的事实信号
//
// 一次性把 StepOutcome 派生为各 detector 共用的信号集 (OutcomeFacts),
// 避免主循环 / detector 各自重新从 outcome 字段判断同一信号 (4 处重复 → 1 处)。
//
// 允许依赖: ./types
// 禁止依赖: ipc/*

import type { StepOutcome } from './types'

/**
 * BEHAVIORAL_CHARTER Rule 13 的三种合法终止 marker。
 *
 * 与 SystemPlugin.BEHAVIORAL_CHARTER 同步; 若那里调整 marker 文本,本处必须同步。
 * 设计上严格 includes (非 fuzzy match) — 接受少量假阴, 防止"已完成"被误判为有 marker。
 */
export const TERMINATION_MARKERS = ['✓ Done', '❓ Need input', '⏸ Blocked'] as const

/** 检测 text 是否含 Rule 13 三种 marker 之一。 */
export function hasTerminationMarker(text: string): boolean {
  if (!text) return false
  for (const marker of TERMINATION_MARKERS) {
    if (text.includes(marker)) return true
  }
  return false
}

/**
 * 派生自 StepOutcome 的事实信号, 给各 detector 消费。
 *
 * 设计原则:
 *   - 字段全为纯派生 (无副作用)
 *   - 命名以 "has*" / "is*" / 信号名为主, 易读
 *   - allToolsFailed 保留三态语义 (null / true / false)
 */
export interface OutcomeFacts {
  /** outcome.toolNames.length > 0 */
  hasToolCall: boolean
  /** outcome.stepText.trim() !== '' */
  hasText: boolean
  /** hasTerminationMarker(outcome.stepText) */
  hasMarker: boolean
  /** outcome.allToolsFailed: null=无工具调用, true=全失败, false=至少一成功 */
  allToolsFailed: boolean | null
  /** outcome.containsSubagentFailure — SUBAGENT_* / DELEGATION_* envelope */
  isSubagentFailure: boolean
  /** outcome.signature — 复合签名 (含工具时非空) */
  signature: string
  /** outcome.exitReason === 'no_tool_calls_no_marker' (Fix C 信号) */
  noMarkerExit: boolean
}

/** 一次性把 StepOutcome 派生为 OutcomeFacts。 */
export function classify(outcome: StepOutcome): OutcomeFacts {
  return {
    hasToolCall: outcome.toolNames.length > 0,
    hasText: outcome.stepText.trim() !== '',
    hasMarker: hasTerminationMarker(outcome.stepText),
    allToolsFailed: outcome.allToolsFailed,
    isSubagentFailure: outcome.containsSubagentFailure,
    signature: outcome.signature,
    noMarkerExit: outcome.exitReason === 'no_tool_calls_no_marker',
  }
}
