// src/main/loop/turn-end-policies/chain.ts — Policy 链组装 + runner
//
// runPolicyChain: 顺序问每个 policy,第一个非 'no-opinion' 决策 wins。
// buildDefaultChain: 默认链组装 (PR 1: 不含 judge;PR 2 加 JudgeCompletionPolicy)。
//
// 链末尾必须有 LegacyNaturalFinalPolicy (永不返 no-opinion) — 保证总有 final decision。
//
// 允许依赖: ./types + 4 个 policy 实现
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { StepOutcome } from '../types'
import type { PolicyContext, TurnEndDecision, TurnEndPolicy } from './types'
import { SdkFinishReasonPolicy } from './sdk-finish-reason'
import { ExplicitTerminationBlockPolicy } from './explicit-termination'
// v4 Phase 4a: PendingContinuationBlockPolicy 删除 — request_continuation virtual tool
// 让 SDK 自然续 loop (有 tool call 走正常路径,不进 turn-end policy 链)。
import { LegacyNaturalFinalPolicy } from './legacy'

/**
 * 顺序遍历 policy 链,第一个非 'no-opinion' 决策 wins。
 *
 * 链末尾的 LegacyNaturalFinalPolicy 永不返 no-opinion,保证总有 final/continue decision。
 * 万一所有 policy 都返 no-opinion (理论上不可能,但防御性),记 error 并返一个保守 final。
 */
export async function runPolicyChain(
  chain: readonly TurnEndPolicy[],
  outcome: StepOutcome,
  ctx: PolicyContext,
): Promise<TurnEndDecision> {
  for (const policy of chain) {
    let decision: TurnEndDecision
    try {
      decision = await policy.evaluate(outcome, ctx)
    } catch (err) {
      // 单个 policy 内部异常 → fail-open,记 warn 继续下一个
      log.warn(`[turn-end-policy] "${policy.name}" threw, falling through:`, err)
      continue
    }

    if (decision.action !== 'no-opinion') {
      log.info(
        `[turn-end-policy] decision by "${policy.name}": action=${decision.action} ` +
          `exitReason=${decision.exitReason ?? '-'} reason="${decision.reason}"`,
      )
      return decision
    }
  }

  // 不该走到这里 — LegacyNaturalFinalPolicy 保底
  log.error('[turn-end-policy] all policies returned no-opinion, defaulting to natural FINAL')
  return {
    action: 'final',
    exitReason: 'no_tool_calls',
    reason: 'all policies no-opinion (unexpected); defensive final',
  }
}

/**
 * 默认链组装。
 *
 * v4 Phase 4a 后:3 个 policy (SDK / 终止 block / legacy)。
 * pending_continuation block 删除,LLM 用 request_continuation tool 替代,
 * SDK 视为有 tool call 自动续 loop,不需要 policy 链消费。
 *
 * 未来 Phase 2 在 LegacyNaturalFinalPolicy 之前插入 JudgeCompletionPolicy。
 */
export function buildDefaultChain(): readonly TurnEndPolicy[] {
  return [
    new SdkFinishReasonPolicy(), // P0: SDK 信号最优先
    new ExplicitTerminationBlockPolicy(), // P1: LLM 显式终止 block (done/need_input/blocked)
    // (v4 Phase 4a 删:PendingContinuationBlockPolicy — 用 request_continuation tool 替代)
    // PR 2: new JudgeCompletionPolicy(...) — 在此位置插入
    new LegacyNaturalFinalPolicy(), // P2: v3.7 natural FINAL 兜底
  ]
}
