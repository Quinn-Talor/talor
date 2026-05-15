// src/main/loop/turn-end-policies/legacy.ts — 链末兜底 policy
//
// "必命中"policy: 永远不返 no-opinion, 确保 chain 总有 final decision。
//
// 决策行为: "无 tool + 有 text" → final + exitReason='no_tool_calls'。
// 适用场景: 上层 policy (SDK 信号 / 显式终止 block) 全 no-opinion 时退到此处。
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
      reason: 'natural FINAL fallback (no upstream policy claimed the turn)',
    }
  }
}
