// src/main/loop/turn-end-policies/chain.ts — Policy 链组装 + runner
//
// runPolicyChain: 顺序问每个 policy, 第一个非 'no-opinion' 决策 wins。
// buildDefaultChain: 默认链组装 — 链末尾必须有 LegacyNaturalFinalPolicy
// (永不返 no-opinion), 保证总有 final / continue 决策。
//
// 允许依赖: ./types + 各 policy 实现
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { StepOutcome } from '../types'
import type { PolicyContext, TurnEndDecision, TurnEndPolicy } from './types'
import { SdkFinishReasonPolicy } from './sdk-finish-reason'
import { ExplicitTerminationBlockPolicy } from './explicit-termination'
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
 * 默认链组装 — 3 个 policy。
 *
 * LLM 续做 (request_continuation tool) 走正常 tool-call 路径,不进此 chain;
 * 因此 chain 只处理"无 tool 调用"的 turn-end 决策。
 */
export function buildDefaultChain(): readonly TurnEndPolicy[] {
  return [
    new SdkFinishReasonPolicy(), // P0: SDK 信号优先 ('length' / 'content-filter')
    new ExplicitTerminationBlockPolicy(), // P1: LLM 显式终止 block (done / need_input / blocked)
    new LegacyNaturalFinalPolicy(), // P2: natural FINAL 兜底
  ]
}
