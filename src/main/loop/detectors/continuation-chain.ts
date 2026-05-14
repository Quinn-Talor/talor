// src/main/loop/detectors/continuation-chain.ts —— 业务层: pending_continuation 滥用兜底
//
// v3.7.3 防滥用 detector: LLM 连续 emit pending_continuation 而不调工具 → 死循环。
//
// 阈值 3:
//   - 2 次时通过 nextHint 警告 LLM ("再来一次就终止")
//   - 3 次直接 triggered → break + 'continuation_chain' exit
//
// reset 条件: 任何一步有 tool call 或 emit 显式终止 block (done/need_input/blocked)
// 即视为"打破续做链",计数归零。
//
// 与 SemanticDetector (DetectorRawContext) 配合: 通过 raw.stepText 走 parser,
// 不污染 outcome-facts (后者明确禁止依赖 talor-block parser)。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter, electron-log, @shared/talor-blocks/*
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict, DetectorRawContext } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'
import { parseTalorBlocks } from '@shared/talor-blocks/talor-block-parser'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'

export interface ContinuationChainOpts {
  /** 触发阈值。默认 3 (允许 2 次连续续做声明,第 3 次 break) */
  limit?: number
}

export class ContinuationChainDetector implements LoopDetector {
  readonly name = 'continuation-chain'
  private chain = 0
  private readonly limit: number
  /** 单次 nextHint 注入控制 — 触发 warning 后,本步取走即清 */
  private pendingWarning: string | null = null

  constructor(opts: ContinuationChainOpts = {}) {
    this.limit = opts.limit ?? 3
  }

  observe(facts: OutcomeFacts, _stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict {
    // 没 raw context (旧 detector 调用方) → 静默
    if (!raw) return NO_TRIGGER

    // 任何一步有 tool call → reset (LLM 真动手了,链断)
    if (facts.hasToolCall) {
      this.chain = 0
      return NO_TRIGGER
    }

    // 检查 stepText 里的 talor block
    const { blocks } = parseTalorBlocks(raw.stepText)

    // 显式终止 block (done/need_input/blocked) → reset
    if (this.hasTerminalBlock(blocks)) {
      this.chain = 0
      return NO_TRIGGER
    }

    // 没 pending_continuation → 不计数也不 reset (其他 detector 各自处理)
    if (!blocks.some((b) => b.type === 'pending_continuation')) {
      return NO_TRIGGER
    }

    // 含 pending_continuation 且无 tool call → 计数 +1
    this.chain++
    log.info(`[ContinuationChainDetector] chain=${this.chain}/${this.limit}`)

    if (this.chain >= this.limit) {
      log.warn(
        `[ContinuationChainDetector] chain reached ${this.chain} (limit=${this.limit}), breaking`,
      )
      // 重置以防同 session 后续被错误复用
      this.chain = 0
      return {
        triggered: true,
        exitReason: 'continuation_chain',
        markFinal: true,
      }
    }

    // 倒数第 1 次 (== limit - 1):警告 LLM 这是最后机会
    if (this.chain === this.limit - 1) {
      this.pendingWarning =
        `You've emitted pending_continuation ${this.chain} time(s) consecutively ` +
        `without executing a tool call. The next pending_continuation without action ` +
        `will terminate the turn. Execute the action you committed to NOW, or emit ` +
        `blocked/done if you cannot proceed.`
    }
    return NO_TRIGGER
  }

  nextHint(): string | null {
    const h = this.pendingWarning
    this.pendingWarning = null // 单次注入
    return h
  }

  private hasTerminalBlock(blocks: TalorBlock[]): boolean {
    return blocks.some((b) => b.type === 'done' || b.type === 'need_input' || b.type === 'blocked')
  }
}
