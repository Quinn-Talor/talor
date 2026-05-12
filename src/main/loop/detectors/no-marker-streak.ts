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

export interface NoMarkerStreakOpts {
  limit?: number // 默认 3
}

export class NoMarkerStreakDetector implements LoopDetector {
  readonly name = 'no-marker-streak'
  private readonly counter: StreakCounter

  constructor(
    private readonly ctx: ForcedSummaryCtx,
    opts: NoMarkerStreakOpts = {},
  ) {
    this.counter = new StreakCounter(opts.limit ?? 3)
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

  nextHint(): string | null {
    return this.counter.value > 0 ? PENDING_MARKER_HINT : null
  }
}
