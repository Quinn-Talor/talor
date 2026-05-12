// src/main/loop/detectors/no-marker-streak.ts
//
// Rule 13 marker 缺失侦测 (Fix C):
//   - 单次无 marker → bump 计数 + 给下一步注入 PENDING_MARKER_HINT
//   - 连续 limit (默认 3) 次 → 触发 forced closure (禁工具强制选 marker, 服务端补 ⏸ Blocked)
//
// reset 条件: 有工具调用 或 文本含 marker。
//
// 允许依赖: ./types, ../outcome-facts, ../streak-counter, ../forced-summary
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'
import { StreakCounter } from '../streak-counter'
import {
  runForcedSummary,
  forcedClosureSummaryOpts,
  type ForcedSummaryCtx,
} from '../forced-summary'

/** 普通 hint — count 1~2 时注入,温和提醒。 */
const PENDING_MARKER_HINT =
  '[Turn-end check] Your previous reply ended without a tool call AND without any of the required ' +
  'termination markers (✓ Done / ❓ Need input / ⏸ Blocked). This means "task not yet finished, ' +
  'but you decided to stop" — which is a bug (Rule 12 + Rule 13). Choose now:\n' +
  '  (a) Continue the work — invoke the next tool this step.\n' +
  '  (b) Close the turn explicitly with one of the three markers as the LAST line of your text:\n' +
  '        ✓ Done — task is actually complete; describe the result above.\n' +
  '        ❓ Need input — say exactly what you need from the user.\n' +
  '        ⏸ Blocked — quote the specific blocker (missing capability / permission / file / data).\n' +
  'Do NOT stop again without either a tool call or one of these markers. Silent stop = bug.'

/** 强化 hint — count 3~4 时注入,明确警告还有几次机会 + 反 markup 反模式。 */
const STRONG_MARKER_HINT =
  '[⚠️ Turn-end check — REPEATED] You have ended multiple replies without a tool call AND without ' +
  'any of the required termination markers (✓ Done / ❓ Need input / ⏸ Blocked).\n\n' +
  '⛔ Do NOT output tool-call markup like <DSML> / <invoke> / <tool_call> in text — those are ' +
  'NOT real tool calls and will be stripped from your reply. Real tool calls are emitted via ' +
  'the tool_use mechanism (the framework handles this when you invoke a tool properly).\n\n' +
  'You have a limited number of attempts left before forced closure. Choose now:\n' +
  '  (a) ACTUALLY invoke a tool this step (not via markup — use the real tool mechanism).\n' +
  '  (b) Close the turn with one of the three markers as the LAST line:\n' +
  '        ✓ Done / ❓ Need input — <what> / ⏸ Blocked — <reason>'

export interface NoMarkerStreakOpts {
  /**
   * 连续多少次"无 tool + 无 marker"触发 forced closure。默认 5。
   *
   * 阈值放宽的理由 (Phase 1B+ UX 修复):
   *   - 旧版 3: 模型只有 2 次自救机会 (count=1,2 注入 hint, count=3 触发)
   *   - 新版 5: 4 次自救机会 (count=1,2 温和 hint; count=3,4 强化 hint; count=5 触发)
   * 给中文模型 (deepseek / qwen) 更多时间从"DSML markup"误用切换到真正的 tool_use。
   */
  limit?: number
}

export class NoMarkerStreakDetector implements LoopDetector {
  readonly name = 'no-marker-streak'
  private readonly counter: StreakCounter

  constructor(
    private readonly ctx: ForcedSummaryCtx,
    opts: NoMarkerStreakOpts = {},
  ) {
    this.counter = new StreakCounter(opts.limit ?? 5)
  }

  observe(facts: OutcomeFacts, stepIndex: number): DetectorVerdict {
    if (facts.noMarkerExit) {
      log.info(
        `[ReactLoop] no-marker exit detected (count=${this.counter.value + 1}/${this.counter.limit})`,
      )
      if (this.counter.bump()) {
        log.warn(
          `[ReactLoop] no-marker streak: ${this.counter.value} consecutive steps ended without marker. Forcing closure.`,
        )
        const count = this.counter.value
        return {
          triggered: true,
          exitReason: 'no_marker_max_attempts',
          markFinal: true,
          runSummary: () => runForcedSummary(this.ctx, stepIndex, forcedClosureSummaryOpts(count)),
        }
      }
    } else if (facts.hasToolCall || facts.hasMarker) {
      this.counter.reset()
    }
    return NO_TRIGGER
  }

  /**
   * 渐进式 hint:
   *   count = 0:       null (无需提示)
   *   count = 1~2:     PENDING_MARKER_HINT  (温和提醒)
   *   count = 3~limit-1: STRONG_MARKER_HINT (强化警告 + 反 DSML markup 反模式)
   *   count = limit:   触发 forced-closure (observe 已返回 triggered)
   */
  nextHint(): string | null {
    const c = this.counter.value
    if (c === 0) return null
    if (c <= 2) return PENDING_MARKER_HINT
    return STRONG_MARKER_HINT
  }
}
