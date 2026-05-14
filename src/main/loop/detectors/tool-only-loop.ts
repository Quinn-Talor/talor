// src/main/loop/detectors/tool-only-loop.ts
//
// 软提示 (v4.1): 模型连续 N 步调用工具但零文本输出 → 注入 hint 鼓励
// 总结进展 + 并行调用。**不再硬切断 turn** (旧 break 行为对合法多表/
// 多文件探索误判过强 — DeepSeek 等 reasoning-light provider 会沉默连查
// 10+ 张表)。
//
// 与 signature-dead-loop / failure-streak 区别:
//   - signature 抓"同参数重试"        (硬切断, 真死循环)
//   - failure-streak 抓"连续失败"      (硬切断 + forced summary)
//   - tool-only 抓"每步换参但永远沉默" (软提示, 让 LLM 自救)
//
// 设计原则 (J-SHOULD-1 协作模型):
//   "用户感知差" ≠ "系统故障"。系统给 LLM 信号, 让 LLM 决定如何处理 —
//   而不是系统单方面切断。真死循环 (同参数重试 / 连续失败 / length 截断)
//   由其他三个 detector 兜底。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'
import { StreakCounter } from '../streak-counter'

export interface ToolOnlyLoopOpts {
  /**
   * Hint 触发阈值。默认 3 — 第 3 步连续零文本就开始注入 hint, 给 LLM
   * 自救机会。注意这是 hint 阈值, 不是 break 阈值 (本 detector 不再 break)。
   */
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
