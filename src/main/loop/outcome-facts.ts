// src/main/loop/outcome-facts.ts —— 业务层: 派生 outcome 的事实信号 (维度 A)
//
// 一次性把 StepOutcome 派生为各 detector 共用的信号集 (OutcomeFacts),
// 避免主循环 / detector 各自重新从 outcome 字段判断同一信号。
//
// 协作模型 (见 standards.md §J-SHOULD-1):
//   - 维度 A 信号 (代码执行错误) → 在此派生, 给 detector 消费
//   - 维度 B 信号 (LLM 输出意图) → 由 @shared/ui-rendering/text-heuristics.ts
//     提供,仅 UI 层消费,不参与 loop 控制
//
// 允许依赖: ./types
// 禁止依赖: ipc/*, @shared/talor-blocks/* (切断 main loop → talor block parser 的运行时依赖)

import type { StepOutcome } from './types'

/**
 * 派生自 StepOutcome 的事实信号, 给 detector 消费。
 *
 * 设计原则:
 *   - 字段全为纯派生 (无副作用)
 *   - 仅维度 A 信号 (代码执行 / 兜底相关)
 *   - allToolsFailed 三态: null=无工具调用 / true=全失败 / false=至少一成功
 */
export interface OutcomeFacts {
  /** outcome.toolNames.length > 0 */
  hasToolCall: boolean
  /** outcome.stepText.trim() !== '' */
  hasText: boolean
  /** outcome.allToolsFailed: null=无工具调用, true=全失败, false=至少一成功 */
  allToolsFailed: boolean | null
  /** outcome.containsSubagentFailure — SUBAGENT_* / DELEGATION_* envelope */
  isSubagentFailure: boolean
  /** outcome.signature — 复合签名 (含工具时非空) */
  signature: string
}

/** 一次性把 StepOutcome 派生为 OutcomeFacts。 */
export function classify(outcome: StepOutcome): OutcomeFacts {
  return {
    hasToolCall: outcome.toolNames.length > 0,
    hasText: outcome.stepText.trim() !== '',
    allToolsFailed: outcome.allToolsFailed,
    isSubagentFailure: outcome.containsSubagentFailure,
    signature: outcome.signature,
  }
}
