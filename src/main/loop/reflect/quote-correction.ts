// src/main/loop/reflect/quote-correction.ts
//
// Turn-end 引用纠错: main LLM 即将 final 时, 对 final 文本跑 quote-verifier。
// 总 mask 数 ≥ 阈值 (默认 2) → 调便宜 model 基于真实 tool result 重写。
// 重写 confidence ≥ 0.5 → userOutput 替换原 final + UI 渲染 + break。
// 否则 → null (放行原 final, 不重写)。

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import { verifyQuotedFacts, verifyEntityGrounding } from '../quote-verifier'
import { collectRecentToolOutputs } from './tool-outputs'
import { runReflectAgent } from './agents/types'
import { QuoteCorrectionAgent } from './agents/quote-correction-agent'
import { reflectionLedger } from '../../repos/reflection-ledger'

export interface QuoteCorrectionReflectorOpts {
  /** 触发重写的最小 mask 数, 默认 2 */
  maskThreshold?: number
}

export class QuoteCorrectionReflector implements Reflector {
  readonly name = 'quote-correction'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['turn-end'],
    maxPerTurn: 1,
  }

  private readonly maskThreshold: number

  constructor(opts: QuoteCorrectionReflectorOpts = {}) {
    this.maskThreshold = opts.maskThreshold ?? 2
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'turn-end') return null
    if (ctx.outcome.toolNames.length > 0 || !ctx.outcome.stepText) return null

    const toolOutputs = collectRecentToolOutputs(ctx.sessionId, 10)
    if (toolOutputs.length === 0) return null // 无 tool result 可校验

    const v1 = verifyQuotedFacts(ctx.outcome.stepText, toolOutputs)
    const v2 = verifyEntityGrounding(v1.cleaned, {
      instruction: ctx.userIntent,
      toolOutputs,
    })
    const totalMask = v1.unverifiedCount + v2.ungroundedCount
    if (totalMask < this.maskThreshold) return null

    log.warn(
      `[Reflect/quote-correction] ${totalMask} masked items detected (unverified=${v1.unverifiedCount}, ungrounded=${v2.ungroundedCount}), 调 LLM 重写`,
    )
    const result = await runReflectAgent(
      QuoteCorrectionAgent,
      {
        userIntent: ctx.userIntent,
        originalText: ctx.outcome.stepText,
        toolOutputs,
        totalMaskCount: totalMask,
      },
      ctx.reflectModel,
      ctx.abortSignal,
    )

    if (!result) return null

    reflectionLedger.record({
      sessionId: ctx.sessionId,
      stepIndex: ctx.stepIndex,
      reflector: this.name,
      outputKind: 'user_output',
      confidence: result.confidence,
      correction: { totalMask },
      reason: `rewrite due to ${v1.unverifiedCount} unverified + ${v2.ungroundedCount} ungrounded`,
    })

    if (result.confidence < 0.5) {
      log.info(`[Reflect/quote-correction] confidence ${result.confidence} < 0.5, 放行原文`)
      return null
    }

    return {
      userOutput: {
        text: result.rewritten,
        label: `[reflect-correction • ${totalMask} masked]`,
        exitReason: 'no_tool_calls',
        reason: `rewrote ${totalMask} unverified items`,
      },
    }
  }
}
