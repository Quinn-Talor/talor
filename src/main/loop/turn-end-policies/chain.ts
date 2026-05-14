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
import { PendingContinuationBlockPolicy } from './pending-continuation'
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
 * 默认链组装。PR 1 范围:仅 4 个 policy (SDK / 终止 block / 续做 block / legacy)。
 * PR 2 在 LegacyNaturalFinalPolicy 之前插入 JudgeCompletionPolicy。
 */
export function buildDefaultChain(): readonly TurnEndPolicy[] {
  return [
    new SdkFinishReasonPolicy(), // P0: SDK 信号最优先
    new ExplicitTerminationBlockPolicy(), // P1: LLM 显式终止 block
    new PendingContinuationBlockPolicy(), // P2: LLM 续做 block
    // PR 2: new JudgeCompletionPolicy(...) — 在此位置插入
    new LegacyNaturalFinalPolicy(), // P3: v3.7 natural FINAL 兜底
  ]
}
