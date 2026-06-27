// src/main/loop/reflect/periodic.ts
//
// Mid-turn 周期反思 — 每 N 步 (默认 5) 主动调便宜 model 看进展。
// confidence < 0.5 时不注入 hint, 但仍记 ledger 供调优。
//
// 降级: code-filter 先检测 trajectory 健康度. healthy (失败率 ≤ 30% + 文本充足 +
// 工具多样) 直接返 null, 跳过 LLM。只有出现异常信号 (高失败率 / 文本荒漠 / 工具单调)
// 才调 LLM 做语义反思。监控目标: 总 LLM 调用降 70%+, 异常路径召回 100% 保留。

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import type { StepOutcome } from '../types'
import { summarizeTrajectory } from './trajectory'
import { runReflectAgent } from './agents/types'
import { PeriodicReflectionAgent } from './agents/periodic-agent'
import { reflectionLedger } from '../../repos/reflection-ledger'

export interface PeriodicReflectorOpts {
  every?: number
  /** 失败率阈值 (默认 0.3) — 超过即视为异常 */
  failureRateThreshold?: number
  /** 平均文本长度阈值 (默认 50) — 低于即视为 tool-only 倾向 */
  minAvgTextLen?: number
  /** 同一 toolName 连续阈值 (默认 3) — 连续 ≥ 阈值视为单调循环 */
  repeatToolThreshold?: number
}

interface AbnormalSignal {
  reason: string
}

/**
 * 检测 trajectory 异常信号. 返回首个命中的 reason, 或 null (healthy).
 *
 * 信号定义 (任一命中即异常):
 *   1. 失败率: allToolsFailed=true 的 step 占比 > 30%
 *   2. 文本荒漠: 平均 stepText 长度 < 50 字符
 *   3. 工具单调: 同一 toolName 在 toolNames[0] 连续出现 ≥ 3 次
 */
function detectAbnormalSignals(
  history: readonly StepOutcome[],
  opts: { failureRate: number; minAvgTextLen: number; repeatToolThreshold: number },
): AbnormalSignal | null {
  if (history.length === 0) return null

  // 1. 失败率
  const failures = history.filter((o) => o.allToolsFailed === true).length
  const failureRate = failures / history.length
  if (failureRate > opts.failureRate) {
    return {
      reason: `failure rate ${(failureRate * 100).toFixed(0)}% > ${opts.failureRate * 100}%`,
    }
  }

  // 2. 文本荒漠
  const totalLen = history.reduce((sum, o) => sum + o.stepText.length, 0)
  const avgLen = totalLen / history.length
  if (avgLen < opts.minAvgTextLen) {
    return { reason: `avg text len ${avgLen.toFixed(0)} < ${opts.minAvgTextLen}` }
  }

  // 3. 工具单调 — 主工具 (toolNames[0]) 连续重复
  let lastTool = ''
  let chain = 0
  for (const o of history) {
    const main = o.toolNames[0] ?? ''
    if (main && main === lastTool) {
      chain++
      if (chain + 1 >= opts.repeatToolThreshold) {
        return { reason: `tool "${main}" repeated ${chain + 1}× consecutively` }
      }
    } else {
      lastTool = main
      chain = 0
    }
  }

  return null
}

export class PeriodicReflector implements Reflector {
  readonly name = 'periodic'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
  }

  private readonly every: number
  private readonly failureRate: number
  private readonly minAvgTextLen: number
  private readonly repeatToolThreshold: number

  constructor(opts: PeriodicReflectorOpts = {}) {
    this.every = opts.every ?? 5
    this.failureRate = opts.failureRateThreshold ?? 0.3
    this.minAvgTextLen = opts.minAvgTextLen ?? 50
    this.repeatToolThreshold = opts.repeatToolThreshold ?? 3
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    if (this.every <= 0) return null
    // 第 (every-1) 步触发 (stepIndex 0-based): step=4 满足 (4+1)%5==0
    if (ctx.stepIndex < this.every - 1) return null
    if ((ctx.stepIndex + 1) % this.every !== 0) return null

    // code-filter: healthy trajectory → 跳过 LLM
    const abnormal = detectAbnormalSignals(ctx.recentHistory, {
      failureRate: this.failureRate,
      minAvgTextLen: this.minAvgTextLen,
      repeatToolThreshold: this.repeatToolThreshold,
    })
    if (!abnormal) {
      log.info(`[Reflect/periodic] healthy trajectory, 跳过 LLM`)
      return null
    }
    log.info(`[Reflect/periodic] abnormal signal: ${abnormal.reason}, 调 LLM`)

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
      ctx.sessionId,
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
