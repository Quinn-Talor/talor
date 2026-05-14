// src/main/loop/turn-end-policies/legacy.ts — P4: v3.7 natural FINAL 兜底
//
// 链末尾的"必命中"policy — 永远不返 no-opinion,确保 chain 总有 final decision。
//
// 行为等价于 v3.7 "无 tool 即 natural FINAL" 默认决策:
//   - judge disabled / 失败 / 超时 → 退到这里 → final + 'no_tool_calls'
//   - 任何上层 policy 全 no-opinion → 退到这里
//
// 设计目的:保 bit-for-bit v3.7 兼容 — 关 judge + 没新 block 信号时,行为等价 v3.7 旧 react-loop。
//
// 允许依赖: ./types
// 禁止依赖: ipc/*

import type { PolicyContext, TurnEndDecision, TurnEndPolicy } from './types'
import type { StepOutcome } from '../types'

export class LegacyNaturalFinalPolicy implements TurnEndPolicy {
  readonly name = 'legacy-natural-final'

  async evaluate(_outcome: StepOutcome, _ctx: PolicyContext): Promise<TurnEndDecision> {
    return {
      action: 'final',
      exitReason: 'no_tool_calls',
      reason: 'v3.7 natural FINAL fallback (no upstream policy claimed the turn)',
    }
  }
}
