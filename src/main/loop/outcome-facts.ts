// src/main/loop/outcome-facts.ts —— 业务层: 派生 outcome 的事实信号 (维度 A)
//
// 一次性把 StepOutcome 派生为各 detector 共用的信号集 (OutcomeFacts),
// 避免主循环 / detector 各自重新从 outcome 字段判断同一信号。
//
// v3.7.1 瘦身: 删除所有 LLM 输出衍生字段 (blocks / hasDone / hasNeedInput /
// hasBlocked / hasPendingConfirm / hasWarning / hasLegacyMarker / hasTermination
// / hasMarker / toolNames / noMarkerExit)。这些字段是为 v3.6 的语义 detector 派生
// 的,v3.7 + v3.7.1 删除 no-marker-streak / WaitAndAct / HallucinatedConfirm 后
// 全无消费者。
//
// 协作原则 (见 docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md):
//   - 维度 A (代码执行错误) 信号 → 留在这里给 detector 用
//   - 维度 B (LLM 输出意图) 启发式 → 移到 @shared/ui-rendering/text-heuristics.ts
//     仅 UI 渲染层消费, 不参与 loop 控制
//
// 允许依赖: ./types
// 禁止依赖: ipc/*, @shared/talor-blocks/*  (切断 main loop → talor block parser 的运行时依赖)

import type { StepOutcome } from './types'

/**
 * 派生自 StepOutcome 的事实信号, 给 detector 消费。
 *
 * 设计原则:
 *   - 字段全为纯派生 (无副作用)
 *   - 仅维度 A 信号 (与代码执行/兜底相关)
 *   - allToolsFailed 保留三态语义 (null / true / false)
 *
 * 不再派生的字段(见文件头注释):
 *   - talor block 衍生字段 (blocks / hasDone / ...)
 *   - LLM 文字 marker 信号 (hasLegacyMarker / hasTermination)
 *   - toolNames (原 WaitAndAct 用,已删)
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
