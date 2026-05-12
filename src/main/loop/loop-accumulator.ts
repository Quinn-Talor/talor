// src/main/loop/loop-accumulator.ts —— 业务层: loop 运行结果聚合
//
// 收敛主循环散落的 4 个累计变量 (fullText / totalSteps / totalToolCalls /
// wroteAssistantFinal) + log 报告逻辑。
//
// 允许依赖: ./types
// 禁止依赖: ipc/*

import type { StepOutcome, LoopExitReason } from './types'

/**
 * 跨步累积的"本轮 loop 结果"状态。
 *
 * 用法:
 *   const acc = new LoopAccumulator()
 *   acc.observe(outcome)
 *   if (verdict.markFinal) acc.markFinal()
 *   if (acc.needsFallback() && exitReason !== 'abort') runFallback(...)
 */
export class LoopAccumulator {
  private _fullText = ''
  private _totalSteps = 0
  private _totalToolCalls = 0
  private _wroteAssistantFinal = false
  private readonly _allToolNames: string[] = []

  /** 累计本步的 stats。每个 step 完成后由主循环调一次。 */
  observe(outcome: StepOutcome): void {
    this._totalSteps++
    this._fullText += outcome.stepText
    this._totalToolCalls += outcome.toolNames.length
    this._allToolNames.push(...outcome.toolNames)
    if (outcome.wroteAssistantFinal) this._wroteAssistantFinal = true
  }

  /**
   * 显式标记"已落最终 assistant 消息" — 在 forced summary 触发后调用,
   * 让循环外的 fallback 兜底不会再触发。
   */
  markFinal(): void {
    this._wroteAssistantFinal = true
  }

  /**
   * 是否需要循环外 fallback summary 兜底。
   *
   * 触发条件: 整轮没写过 final 消息 AND 整轮纯文本累计为空。
   * 主循环还应额外判断 exitReason !== 'abort' (用户主动中止不兜底)。
   */
  needsFallback(): boolean {
    return !this._wroteAssistantFinal && this._fullText.length === 0
  }

  get totalSteps(): number {
    return this._totalSteps
  }
  get totalToolCalls(): number {
    return this._totalToolCalls
  }
  get fullTextLength(): number {
    return this._fullText.length
  }
  get wroteAssistantFinal(): boolean {
    return this._wroteAssistantFinal
  }

  /** 报告字符串 (供日志输出)。 */
  buildReport(
    totalMs: number,
    exitReason: LoopExitReason,
  ): {
    summary: string
    detail: string
  } {
    const uniqueTools = [...new Set(this._allToolNames)]
    return {
      summary: `done | steps: ${this._totalSteps} | total: ${(totalMs / 1000).toFixed(1)}s | exit: ${exitReason}`,
      detail: `text: ${this._fullText.length} chars | tools: ${this._totalToolCalls} calls [${uniqueTools.join(', ') || 'none'}]`,
    }
  }
}
