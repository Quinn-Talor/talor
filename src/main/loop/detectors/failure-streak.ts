// src/main/loop/detectors/failure-streak.ts
//
// 失败连击侦测: 连续 N 步 allToolsFailed=true 即触发 forced summary。
//
// 加权机制 (E1): SUBAGENT_*/DELEGATION_* 失败 +2, 普通 tool 失败 +1。
// 子 loop 已烧掉一轮推理, 代价更高, 触发 failure-recovery 应更早。
//
// 三态计数:
//   - allToolsFailed=null (无工具调用): 不参与计数, 不 reset (保守)
//   - allToolsFailed=true:              bump 计数, 达阈值触发
//   - allToolsFailed=false (至少一成功): reset 计数
//
// Hint 注入 (G5): streak == limit-1 时给一条"渐进式失败提示", 让模型有自救机会。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter, ../forced-summary
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'
import { StreakCounter } from '../streak-counter'
import {
  runForcedSummary,
  failureStreakSummaryOpts,
  type ForcedSummaryCtx,
} from '../forced-summary'

export interface FailureStreakOpts {
  limit?: number // 默认 3
  subagentWeight?: number // 默认 2
}

export class FailureStreakDetector implements LoopDetector {
  readonly name = 'failure-streak'
  private readonly counter: StreakCounter
  private readonly subagentWeight: number

  constructor(
    private readonly ctx: ForcedSummaryCtx,
    opts: FailureStreakOpts = {},
  ) {
    this.counter = new StreakCounter(opts.limit ?? 3)
    this.subagentWeight = opts.subagentWeight ?? 2
  }

  observe(facts: OutcomeFacts, stepIndex: number): DetectorVerdict {
    if (facts.allToolsFailed === true) {
      const weight = facts.isSubagentFailure ? this.subagentWeight : 1
      const triggered = this.counter.bump(weight)

      if (facts.isSubagentFailure) {
        log.warn(
          `[ReactLoop] SUBAGENT_* failure detected, streak +${this.subagentWeight} (now ${this.counter.value})`,
        )
      }

      if (triggered) {
        log.warn(
          `[ReactLoop] Failure streak: ${this.counter.value} (limit ${this.counter.limit}). Switching to forced summary.`,
        )
        const count = this.counter.value
        return {
          triggered: true,
          exitReason: 'repeated_error',
          markFinal: true,
          runSummary: () => runForcedSummary(this.ctx, stepIndex, failureStreakSummaryOpts(count)),
        }
      }
    } else if (facts.allToolsFailed === false) {
      this.counter.reset()
    }
    return NO_TRIGGER
  }

  nextHint(): string | null {
    if (this.counter.value === this.counter.limit - 1) {
      return (
        `[failure-streak warning] Your previous ${this.counter.value} tool calls all returned errors. ` +
        `One more failure and tool execution will stop for this turn. ` +
        `Reconsider before your next action: try a different tool or different parameters, ` +
        `verify your assumptions (paths exist? syntax correct?), or summarize what you've tried ` +
        `and ask the user for guidance. Do NOT repeat the same approach.`
      )
    }
    return null
  }
}
