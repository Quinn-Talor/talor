// src/main/loop/detectors/length-truncation-streak.ts — v3.7.3 follow-up
//
// 防 finishReason='length' 截断死循环。
//
// 场景: provider 持续返 finishReason='length',SdkFinishReasonPolicy 每次都 continue,
// 但模型每步仍 length 截断 (典型:reasoning 烧 token / max_tokens 配太小 / 模型试图
// inline 大内容)。若不限,react-loop 永远在续做。
//
// 阈值 3:
//   - chain=2 时 nextHint 警告 "再来一次就 break"
//   - chain=3 时 triggered → exit 'continuation_chain' (复用,与 pending_continuation 一类)
//
// reset 条件:任何一步 finishReason 不是 'length' (例如 'stop'/'tool-calls')→ chain=0
//
// 与 ContinuationChainDetector 区别:
//   - ContinuationChainDetector:LLM 主动 emit pending_continuation 但不动手
//   - LengthTruncationStreakDetector:provider 报 length,框架被动 continue
// 两者机制不同但症状相似 (loop 续做但不前进),共用 exitReason='continuation_chain'。
//
// 允许依赖: ./types, electron-log
// 禁止依赖: ipc/* (这是基础设施层 detector,可被业务层调用)

import log from 'electron-log'
import type { FinishReason } from 'ai'
import type { LoopDetector, DetectorVerdict, DetectorRawContext } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'

export interface LengthTruncationStreakOpts {
  /** 触发阈值。默认 3 (允许 2 次连续 length,第 3 次 break) */
  limit?: number
}

/**
 * 检查 detector 用的 raw context 是否携带 finishReason。
 *
 * v3.7.3 扩展 DetectorRawContext 时这是新增字段;旧 detector 不传也兼容。
 * 缺失 → 静默 (向后兼容)。
 */
function getFinishReason(raw?: DetectorRawContext): FinishReason | undefined {
  if (!raw) return undefined
  const r = (raw as DetectorRawContext & { finishReason?: FinishReason }).finishReason
  return r
}

export class LengthTruncationStreakDetector implements LoopDetector {
  readonly name = 'length-truncation-streak'
  private chain = 0
  private readonly limit: number
  private pendingWarning: string | null = null

  constructor(opts: LengthTruncationStreakOpts = {}) {
    this.limit = opts.limit ?? 3
  }

  observe(_facts: OutcomeFacts, _stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict {
    const finishReason = getFinishReason(raw)
    if (finishReason === undefined) return NO_TRIGGER

    if (finishReason === 'length') {
      this.chain++
      log.info(`[LengthTruncationStreakDetector] chain=${this.chain}/${this.limit}`)

      if (this.chain >= this.limit) {
        log.warn(
          `[LengthTruncationStreakDetector] chain reached ${this.chain} (limit=${this.limit}), breaking. ` +
            `Likely cause: reasoning consuming output budget, or trying to inline a huge artifact.`,
        )
        this.chain = 0
        return {
          triggered: true,
          exitReason: 'continuation_chain', // 与 pending_continuation 共用 exit code
          markFinal: true,
        }
      }

      if (this.chain === this.limit - 1) {
        this.pendingWarning =
          `Your output has been truncated by max_tokens ${this.chain} time(s) consecutively. ` +
          `The next length truncation will terminate the turn. Options:\n` +
          `  - If outputting a large artifact: USE THE WRITE TOOL (its input budget is separate).\n` +
          `  - If reasoning is consuming tokens: be concise, skip planning, act with tools directly.\n` +
          `  - If the user request needs splitting: ask the user to break it into smaller steps.`
      }
    } else {
      // 任何非 length 的 finishReason → reset (loop 已经走出 length 模式)
      this.chain = 0
    }
    return NO_TRIGGER
  }

  nextHint(): string | null {
    const h = this.pendingWarning
    this.pendingWarning = null
    return h
  }
}
