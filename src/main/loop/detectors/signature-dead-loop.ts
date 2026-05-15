// src/main/loop/detectors/signature-dead-loop.ts
//
// 死循环侦测 + 终结反思 — 混合体, 同实例双接口共享 state。
//
// Detector 角色 (observe): 同 (toolName + inputHash + outputHash) 复合签名连击侦测。
//   阈值分错误态差异化:
//     allToolsFailed=true:  阈值 1 (第 2 次同错 = 死循环)
//     allToolsFailed=false: 阈值 2 (允许合理幂等读)
//   触发时 triggered=true + 设 pendingWrapUp.
//
// Reflector 角色 (reflect, post-step): 消费 pendingWrapUp, 返回 wrapUp 跑
// forced-summary 让 LLM 总结死循环原因 + 落库 + break turn。
//
// 不参与计数的步: 无工具调用 (signature='') — 避免模型穿插纯文本逃脱侦测,
// 也不 reset lastSignature。
//
// 允许依赖: ./types, ../reflect/types, ../outcome-facts, ../forced-summary, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Detector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
import type {
  Reflector,
  ReflectorCapabilities,
  ReflectorOutcome,
  ReflectContext,
} from '../reflect/types'
import type { OutcomeFacts } from '../outcome-facts'
import {
  runForcedSummary,
  signatureDeadLoopSummaryOpts,
  type ForcedSummaryCtx,
} from '../forced-summary'

export interface SignatureDeadLoopOpts {
  withErrorThreshold?: number // 默认 1
  noErrorThreshold?: number // 默认 2
}

export class SignatureDeadLoop implements Detector, Reflector {
  readonly name = 'signature-dead-loop'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
    maxPerTurn: 1,
    priority: 20,
  }

  private lastSignature = ''
  private repeatCount = 0
  private pendingWrapUp: { sig: string; count: number; isError: boolean } | null = null

  constructor(
    private readonly ctx: ForcedSummaryCtx,
    private readonly opts: SignatureDeadLoopOpts = {},
  ) {}

  observe(facts: OutcomeFacts): DetectorVerdict {
    if (!facts.signature) return NO_TRIGGER
    if (facts.signature === this.lastSignature) {
      this.repeatCount++
      const isError = facts.allToolsFailed === true
      const threshold = isError
        ? (this.opts.withErrorThreshold ?? 1)
        : (this.opts.noErrorThreshold ?? 2)
      if (this.repeatCount >= threshold) {
        log.warn(
          `[Detector] signature-dead-loop: "${facts.signature}" ×${this.repeatCount + 1} (isError=${isError})`,
        )
        this.pendingWrapUp = { sig: facts.signature, count: this.repeatCount, isError }
        return { triggered: true, exitReason: 'repeated_error' }
      }
    } else {
      this.lastSignature = facts.signature
      this.repeatCount = 0
    }
    return NO_TRIGGER
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    const w = this.pendingWrapUp
    if (!w) return null
    this.pendingWrapUp = null
    const stepIndex = ctx.stepIndex
    return {
      wrapUp: {
        exitReason: 'repeated_error',
        markFinal: true,
        runSummary: () =>
          runForcedSummary(
            this.ctx,
            stepIndex,
            signatureDeadLoopSummaryOpts(w.sig, w.count, w.isError),
          ),
      },
    }
  }
}
