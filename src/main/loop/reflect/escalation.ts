// src/main/loop/reflect/escalation.ts
//
// L1 reflector (failure-streak / tool-only-loop) 注入 hint 连续 N 步无响应 →
// 升级到 LLM reflect (复用 PeriodicReflectionAgent 同 schema, 但 prompt 标注
// "L1 hints ignored")。
//
// 主循环通过 wasPreviousStepL1Hinted 回调告知本 reflector 上一步是否有 L1 hint 被注入。
// streak 在 track() 里逐步推进 (chain 每步保证调用), 不依赖本 reflector 是否轮到产出;
// 主循环把它排在 tool-only-loop 之前, 达阈值时升级产出才能顶替被忽略的 L1 hint。

import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import { summarizeTrajectory } from './trajectory'
import { runReflectAgent } from './agents/types'
import { PeriodicReflectionAgent } from './agents/periodic-agent'
import { reflectionLedger } from '../../repos/reflection-ledger'

export interface EscalationReflectorOpts {
  /** L1 hint 连续注入达此阈值时升级 LLM reflect, 默认 2 */
  threshold?: number
  /** 主循环每步告知"上步是否注入了 L1 hint" */
  wasPreviousStepL1Hinted?: () => boolean
}

export class EscalationReflector implements Reflector {
  readonly name = 'escalation'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
    maxPerTurn: 2,
    usesLlm: true,
  }

  private hintStreak = 0
  private readonly threshold: number
  private readonly wasPreviousStepL1Hinted: () => boolean

  constructor(opts: EscalationReflectorOpts = {}) {
    this.threshold = opts.threshold ?? 2
    this.wasPreviousStepL1Hinted = opts.wasPreviousStepL1Hinted ?? (() => false)
  }

  track(ctx: ReflectContext): void {
    if (ctx.phase !== 'post-step') return
    if (this.wasPreviousStepL1Hinted()) this.hintStreak++
    else this.hintStreak = 0
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    if (this.hintStreak < this.threshold) return null
    this.hintStreak = 0

    const failures = ctx.recentHistory.filter((o) => o.allToolsFailed === true).length
    const reflection = await runReflectAgent(
      PeriodicReflectionAgent,
      {
        userIntent: ctx.userIntent,
        trajectory: summarizeTrajectory(ctx.recentHistory),
        totalSteps: ctx.stepIndex + 1,
        toolStats: { failures, total: ctx.recentHistory.length },
      },
      ctx.reflectModel,
      ctx.abortSignal,
      ctx.sessionId,
    )
    if (!reflection) return null

    reflectionLedger.record({
      sessionId: ctx.sessionId,
      stepIndex: ctx.stepIndex,
      reflector: this.name,
      outputKind: 'hint',
      confidence: reflection.confidence,
      reason: `L1 hints ignored ${this.threshold}×`,
    })

    if (reflection.confidence < 0.5) return null

    return {
      hint:
        `[reflection — L1 hints ignored ${this.threshold}×] ${reflection.progressSoFar}\n` +
        (reflection.blockerIdentified ? `Blocker: ${reflection.blockerIdentified}\n` : '') +
        `Guidance: ${reflection.nextStepGuidance}`,
    }
  }
}
