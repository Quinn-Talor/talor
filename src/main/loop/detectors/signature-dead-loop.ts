// src/main/loop/detectors/signature-dead-loop.ts
//
// 死循环侦测: 同 (toolName + inputHash + outputHash) 复合签名连出现 N 次即触发。
//
// 阈值分错误态差异化:
//   - allToolsFailed=true:  阈值 1 (第 2 次同错 = 死循环, 模型显然没读错误)
//   - allToolsFailed=false: 阈值 2 (第 3 次同调用才 break, 允许合理的幂等读)
//
// 不参与签名计数的步:
//   - 无工具调用 (signature='') — 避免模型在死循环中穿插一步纯文本逃脱侦测,
//     也不 reset lastSignature
//
// 允许依赖: ./types, ../outcome-facts
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
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

export class SignatureDeadLoopDetector implements LoopDetector {
  readonly name = 'signature-dead-loop'

  private lastSignature = ''
  private repeatCount = 0

  /**
   * @param ctx ForcedSummaryCtx — 触发死循环时跑解释性 summary 让用户看到原因。
   *            没有 summary 用户只看到"任务突然停了"——这是旧版的 UX 缺陷。
   */
  constructor(
    private readonly ctx: ForcedSummaryCtx,
    private readonly opts: SignatureDeadLoopOpts = {},
  ) {}

  observe(facts: OutcomeFacts, stepIndex: number = 0): DetectorVerdict {
    if (!facts.signature) return NO_TRIGGER

    if (facts.signature === this.lastSignature) {
      this.repeatCount++
      const isErrorSig = facts.allToolsFailed === true
      const threshold = isErrorSig
        ? (this.opts.withErrorThreshold ?? 1)
        : (this.opts.noErrorThreshold ?? 2)
      if (this.repeatCount >= threshold) {
        log.warn(
          `[ReactLoop] Dead loop: signature "${facts.signature}" repeated ${this.repeatCount + 1}x (isError=${isErrorSig}). Breaking with forced summary.`,
        )
        const signature = facts.signature
        const repeatCount = this.repeatCount
        return {
          triggered: true,
          exitReason: 'repeated_error',
          markFinal: true,
          runSummary: () =>
            runForcedSummary(
              this.ctx,
              stepIndex,
              signatureDeadLoopSummaryOpts(signature, repeatCount, isErrorSig),
            ),
        }
      }
    } else {
      this.lastSignature = facts.signature
      this.repeatCount = 0
    }
    return NO_TRIGGER
  }
}
