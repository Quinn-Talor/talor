// src/main/loop/reflect/failure-streak.ts
//
// 连续 N 步工具失败 → wrap-up forced-summary (L1, 硬编码反思器, 不调 LLM)。
// SUBAGENT_/DELEGATION_ envelope 加权 +2 (子 loop 失败代价更高, 更早触发)。
// chain == limit-1 时输出最后机会 hint 让 main LLM 自救。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter, ../forced-summary, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
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

export class FailureStreakReflector implements Reflector {
  readonly name = 'failure-streak'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
    // 2 = 允许一次 hint (chain==limit-1 警告) + 一次 wrapUp (chain==limit 触发)
    maxPerTurn: 2,
  }

  private readonly counter: StreakCounter
  private readonly subagentWeight: number

  constructor(
    private readonly ctx: ForcedSummaryCtx,
    opts: FailureStreakOpts = {},
  ) {
    this.counter = new StreakCounter(opts.limit ?? 3)
    this.subagentWeight = opts.subagentWeight ?? 2
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    const { facts, stepIndex } = ctx
    if (facts.allToolsFailed === true) {
      const weight = facts.isSubagentFailure ? this.subagentWeight : 1
      const triggered = this.counter.bump(weight)
      if (triggered) {
        const count = this.counter.value
        log.warn(`[Reflect] failure-streak wrap-up (count=${count}, limit=${this.counter.limit})`)
        return {
          wrapUp: {
            exitReason: 'repeated_error',
            markFinal: true,
            runSummary: () =>
              runForcedSummary(this.ctx, stepIndex, failureStreakSummaryOpts(count)),
          },
        }
      }
      if (this.counter.value === this.counter.limit - 1) {
        return {
          hint:
            `[failure-streak warning] Your previous ${this.counter.value} tool calls all returned errors. ` +
            `One more failure and tool execution will stop. Reconsider: try a different tool / different parameters, ` +
            `verify assumptions (paths exist? syntax correct?), or summarize what you tried and ask the user. ` +
            `Do NOT repeat the same approach.`,
        }
      }
    } else if (facts.allToolsFailed === false) {
      this.counter.reset()
    }
    return null
  }
}
