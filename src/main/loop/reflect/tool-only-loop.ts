// src/main/loop/reflect/tool-only-loop.ts
//
// 软提示侦测 (L1): 连续 N 步工具调用零文本 → advisor hint 鼓励总结进展 + 并行调用。
// 从不 wrap-up — 用户感知差不是系统故障; 真死循环由其他 reflector / detector 兜底。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import { StreakCounter } from '../streak-counter'

export interface ToolOnlyLoopOpts {
  /** 连续零文本工具步达此阈值开始注入 hint, 默认 3 */
  hintAt?: number
}

export class ToolOnlyLoopReflector implements Reflector {
  readonly name = 'tool-only-loop'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['post-step'],
    // 无 maxPerTurn — hint 持续注入直到 LLM 出文本 reset
  }

  private readonly counter: StreakCounter

  constructor(opts: ToolOnlyLoopOpts = {}) {
    this.counter = new StreakCounter(opts.hintAt ?? 3)
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'post-step') return null
    const { facts } = ctx
    if (facts.hasToolCall && !facts.hasText) {
      this.counter.bump()
      if (this.counter.value === this.counter.limit) {
        log.info(`[Reflect] tool-only-loop streak=${this.counter.value} silent steps`)
      }
    } else if (facts.hasText) {
      this.counter.reset()
    }
    if (this.counter.value < this.counter.limit) return null
    return {
      hint:
        `[progress-report needed] You have made ${this.counter.value} consecutive tool calls without ` +
        `reporting any progress in text. BEFORE your next tool call:\n` +
        `  1. Write one short paragraph summarizing what you have learned so far.\n` +
        `  2. If remaining tool calls are INDEPENDENT, batch them as PARALLEL tool_use blocks in one response.\n` +
        `  3. If you already have enough information to answer, ANSWER NOW and stop calling tools.`,
    }
  }
}
