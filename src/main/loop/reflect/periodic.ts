// src/main/loop/reflect/periodic.ts
//
// Mid-turn 周期反思 — 每 N 步 (默认 5) 主动调便宜 model 看进展。
// confidence < 0.5 时不注入 hint, 但仍记 ledger 供调优。

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import { summarizeTrajectory } from './trajectory'
import { runReflectAgent } from './agents/types'
import { PeriodicReflectionAgent } from './agents/periodic-agent'
import { reflectionLedger } from '../../repos/reflection-ledger'

export interface PeriodicReflectorOpts {
  every?: number
}

export class PeriodicReflector implements Reflector {
  readonly name = 'periodic'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
  }

  private readonly every: number

  constructor(opts: PeriodicReflectorOpts = {}) {
    this.every = opts.every ?? 5
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    if (this.every <= 0) return null
    // 第 (every-1) 步触发 (stepIndex 0-based): step=4 满足 (4+1)%5==0
    if (ctx.stepIndex < this.every - 1) return null
    if ((ctx.stepIndex + 1) % this.every !== 0) return null

    const failures = ctx.recentHistory.filter((o) => o.allToolsFailed === true).length
    const total = ctx.recentHistory.length
    const reflection = await runReflectAgent(
      PeriodicReflectionAgent,
      {
        userIntent: ctx.userIntent,
        trajectory: summarizeTrajectory(ctx.recentHistory),
        totalSteps: ctx.stepIndex + 1,
        toolStats: { failures, total },
      },
      ctx.reflectModel,
      ctx.abortSignal,
    )
    if (!reflection) return null

    reflectionLedger.record({
      sessionId: ctx.sessionId,
      stepIndex: ctx.stepIndex,
      reflector: this.name,
      outputKind: 'hint',
      confidence: reflection.confidence,
      reason: reflection.blockerIdentified ?? reflection.strategyShift,
    })

    if (reflection.confidence < 0.5) {
      log.info(`[Reflect/periodic] confidence ${reflection.confidence} < 0.5, 丢弃 hint`)
      return null
    }

    return {
      hint:
        `[reflection] ${reflection.progressSoFar}` +
        (reflection.blockerIdentified ? `\nBlocker: ${reflection.blockerIdentified}` : '') +
        `\nGuidance: ${reflection.nextStepGuidance}`,
    }
  }
}
