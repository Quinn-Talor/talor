// src/main/loop/detectors/tool-only-loop.ts
//
// 工具循环侦测: 模型连续 N 步调用工具但零文本输出 → 视为"不向用户报告"的死循环。
//
// 与 signature-dead-loop 区别:
//   - signature 抓"同参数重试"
//   - tool-only 抓"每次不同参数但永远不报告" (signature 不重复无法识别)
//
// 触发后直接 break (无 forced summary), 走主循环外 fallback summary 兜底。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'
import { StreakCounter } from '../streak-counter'

export interface ToolOnlyLoopOpts {
  limit?: number // 默认 8 — 允许较长链式调用 (如 6-7 步独立读 + 最终一步分析)
}

export class ToolOnlyLoopDetector implements LoopDetector {
  readonly name = 'tool-only-loop'
  private readonly counter: StreakCounter

  constructor(opts: ToolOnlyLoopOpts = {}) {
    this.counter = new StreakCounter(opts.limit ?? 8)
  }

  observe(facts: OutcomeFacts): DetectorVerdict {
    if (facts.hasToolCall && !facts.hasText) {
      if (this.counter.bump()) {
        log.warn(
          `[ReactLoop] Tool-only loop: ${this.counter.value} consecutive steps with tools but no text. Breaking.`,
        )
        return { triggered: true, exitReason: 'tool_only_loop' }
      }
    } else if (facts.hasText) {
      // 有文本 → reset。无工具无文本 (empty_text) 不 reset 也不计数 — 保守。
      this.counter.reset()
    }
    return NO_TRIGGER
  }
}
