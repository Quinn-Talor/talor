// src/main/loop/detectors/length-truncation-streak.ts
//
// 防 finishReason='length' 截断死循环 — 混合体, 同实例双接口。
//
// Detector 角色 (observe): chain ≥ limit (默认 3) 时硬切断。LLM 看不到 finishReason,
//   不切断会陷无尽截断循环。
// Reflector 角色 (reflect, post-step): chain == limit-1 时输出 hint, 教 LLM
//   选 strategy (用 write tool / 收敛 reasoning / 拆任务)。
//
// reset 条件: 任何非 'length' 的 finishReason → chain=0。
//
// 允许依赖: ./types, ../reflect/types, ../outcome-facts, ai, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { FinishReason } from 'ai'
import type { Detector, DetectorVerdict, DetectorRawContext } from './types'
import { NO_TRIGGER } from './types'
import type {
  Reflector,
  ReflectorCapabilities,
  ReflectorOutcome,
  ReflectContext,
} from '../reflect/types'
import type { OutcomeFacts } from '../outcome-facts'

export interface LengthTruncationStreakOpts {
  limit?: number // 默认 3
}

export class LengthTruncationStreak implements Detector, Reflector {
  readonly name = 'length-truncation-streak'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
    maxPerTurn: 1,
    priority: 20,
  }

  private chain = 0
  private readonly limit: number
  private pendingHint: string | null = null

  constructor(opts: LengthTruncationStreakOpts = {}) {
    this.limit = opts.limit ?? 3
  }

  observe(_facts: OutcomeFacts, _stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict {
    const fr = raw?.finishReason as FinishReason | undefined
    if (fr === undefined) return NO_TRIGGER
    if (fr === 'length') {
      this.chain++
      log.info(`[Detector] length-truncation chain=${this.chain}/${this.limit}`)
      if (this.chain >= this.limit) {
        this.chain = 0
        return { triggered: true, exitReason: 'continuation_chain' }
      }
      if (this.chain === this.limit - 1) {
        this.pendingHint =
          `Your output has been truncated by max_tokens ${this.chain} time(s) consecutively. ` +
          `The next length truncation will terminate the turn. Options:\n` +
          `  - If outputting a large artifact: USE THE WRITE TOOL (input budget is separate).\n` +
          `  - If reasoning is consuming tokens: be concise, skip planning, act directly.\n` +
          `  - If the user request is too big: ask the user to split it.`
      }
    } else {
      this.chain = 0
    }
    return NO_TRIGGER
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    const h = this.pendingHint
    if (!h) return null
    this.pendingHint = null
    return { hint: h }
  }
}
