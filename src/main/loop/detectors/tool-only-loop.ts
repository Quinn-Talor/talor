// src/main/loop/detectors/tool-only-loop.ts
//
// 软提示侦测: 模型连续 N 步调用工具但零文本输出 → 注入 nextHint 鼓励
// 总结进展 + 并行调用。从不 triggered=true (不硬切断 turn)。
//
// 与同模块其他 detector 的分工:
//   - signature-dead-loop:  同参数重试 (硬切断 + forced summary)
//   - failure-streak:       连续失败 (硬切断 + forced summary)
//   - tool-only:            零文本工具链 (仅提示, 让 LLM 自救)
//   - length-truncation:    连续 finishReason='length' (硬切断)
//
// 设计原则 (J-SHOULD-1 协作模型):
//   "用户感知差" ≠ "系统故障"。系统给信号, LLM 决定如何处理 —
//   不由系统单方面切断。真死循环由其他三个 detector 兜底。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'
import { StreakCounter } from '../streak-counter'

export interface ToolOnlyLoopOpts {
  /** Hint 触发阈值。默认 3 — 连续 3 步零文本即开始注入 hint。 */
  hintAt?: number
}

export class ToolOnlyLoopDetector implements LoopDetector {
  readonly name = 'tool-only-loop'
  private readonly counter: StreakCounter

  constructor(opts: ToolOnlyLoopOpts = {}) {
    this.counter = new StreakCounter(opts.hintAt ?? 3)
  }

  observe(facts: OutcomeFacts): DetectorVerdict {
    if (facts.hasToolCall && !facts.hasText) {
      this.counter.bump()
      if (this.counter.value === this.counter.limit) {
        log.info(
          `[ReactLoop] tool-only streak hit ${this.counter.value} silent tool steps — hint will be injected next step`,
        )
      }
    } else if (facts.hasText) {
      // 有文本 → reset。无工具无文本 (empty_text) 不 reset 也不计数 — 保守。
      this.counter.reset()
    }
    return NO_TRIGGER
  }

  nextHint(): string | null {
    if (this.counter.value < this.counter.limit) return null
    return (
      `[progress-report needed] You have made ${this.counter.value} consecutive tool calls without ` +
      `reporting any progress in text. The user sees no narration of what you are doing. ` +
      `BEFORE your next tool call:\n` +
      `  1. Write one short paragraph summarizing what you have learned so far.\n` +
      `  2. If the remaining tool calls are INDEPENDENT (e.g. inspecting several tables, reading ` +
      `multiple files, running unrelated queries), batch them as PARALLEL tool calls in a single ` +
      `step (multiple tool_use blocks in one response) instead of serializing one per step.\n` +
      `  3. If you already have enough information to answer the user's question, ANSWER NOW ` +
      `and stop calling tools.`
    )
  }
}
