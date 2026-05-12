import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockRunForcedSummary } = vi.hoisted(() => ({
  mockRunForcedSummary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../forced-summary', () => ({
  runForcedSummary: mockRunForcedSummary,
  forcedClosureSummaryOpts: vi.fn((c: number) => ({ label: `[fc-${c}]` })),
}))

import { NoMarkerStreakDetector } from './no-marker-streak'
import type { OutcomeFacts } from '../outcome-facts'
import type { ForcedSummaryCtx } from '../forced-summary'

function facts(overrides: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: false,
    hasText: false,
    hasMarker: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: '',
    noMarkerExit: false,
    ...overrides,
  }
}

const stubCtx = {} as ForcedSummaryCtx

describe('NoMarkerStreakDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('noMarkerExit=false → 不触发', () => {
    const d = new NoMarkerStreakDetector(stubCtx)
    expect(d.observe(facts({ noMarkerExit: false }), 0).triggered).toBe(false)
  })

  it('连续 3 次 noMarkerExit (默认 limit) → 第 3 次触发', () => {
    const d = new NoMarkerStreakDetector(stubCtx)
    expect(d.observe(facts({ noMarkerExit: true }), 0).triggered).toBe(false)
    expect(d.observe(facts({ noMarkerExit: true }), 1).triggered).toBe(false)
    const v = d.observe(facts({ noMarkerExit: true }), 2)
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('no_marker_max_attempts')
    expect(v.markFinal).toBe(true)
    expect(v.runSummary).toBeDefined()
  })

  it('hasToolCall=true → reset 计数', () => {
    const d = new NoMarkerStreakDetector(stubCtx, { limit: 3 })
    d.observe(facts({ noMarkerExit: true }), 0)
    d.observe(facts({ noMarkerExit: true }), 1)
    d.observe(facts({ hasToolCall: true }), 2) // reset
    expect(d.observe(facts({ noMarkerExit: true }), 3).triggered).toBe(false)
  })

  it('hasMarker=true → reset 计数', () => {
    const d = new NoMarkerStreakDetector(stubCtx, { limit: 3 })
    d.observe(facts({ noMarkerExit: true }), 0)
    d.observe(facts({ noMarkerExit: true }), 1)
    d.observe(facts({ hasMarker: true }), 2) // reset
    expect(d.observe(facts({ noMarkerExit: true }), 3).triggered).toBe(false)
  })

  it('runSummary 调用 forced summary', async () => {
    const d = new NoMarkerStreakDetector(stubCtx, { limit: 3 })
    d.observe(facts({ noMarkerExit: true }), 0)
    d.observe(facts({ noMarkerExit: true }), 1)
    const v = d.observe(facts({ noMarkerExit: true }), 2)
    await v.runSummary!()
    expect(mockRunForcedSummary).toHaveBeenCalledTimes(1)
  })

  describe('渐进式 hint (limit=3 时 1 弱 / 2 强)', () => {
    it('count=0 → null', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      expect(d.nextHint?.()).toBeNull()
    })

    it('count=1 (即 limit-2) → PENDING_MARKER_HINT (温和提醒)', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      d.observe(facts({ noMarkerExit: true }), 0)
      const hint = d.nextHint?.()
      expect(hint).toContain('[Turn-end check]')
      expect(hint).not.toContain('REPEATED')
    })

    it('count=2 (即 limit-1, 下次必触发) → STRONG_MARKER_HINT', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      d.observe(facts({ noMarkerExit: true }), 0)
      d.observe(facts({ noMarkerExit: true }), 1)
      const hint = d.nextHint?.()
      expect(hint).toContain('REPEATED')
      // 通用化:不点名具体模型的 markup 方言 (DSML/invoke 等),用通用反模式描述
      expect(hint).toContain('pseudo tool-call syntax')
      expect(hint).toContain('will be stripped')
      // 不触发:不应硬编码具体模型的 markup 标签名 (DSML/invoke/tool_call)
      expect(hint).not.toMatch(/<DSML>|<invoke>|<tool_call>/)
    })
  })

  describe('自定义 limit 同样适用"前半温和后半强化"规则', () => {
    it('limit=5: count=1,2,3 温和; count=4 (limit-1) 强化', () => {
      const d = new NoMarkerStreakDetector(stubCtx, { limit: 5 })
      d.observe(facts({ noMarkerExit: true }), 0) // count=1
      expect(d.nextHint?.()).toContain('[Turn-end check]')
      d.observe(facts({ noMarkerExit: true }), 1) // count=2
      expect(d.nextHint?.()).toContain('[Turn-end check]')
      d.observe(facts({ noMarkerExit: true }), 2) // count=3
      expect(d.nextHint?.()).toContain('[Turn-end check]')
      d.observe(facts({ noMarkerExit: true }), 3) // count=4 = limit-1
      expect(d.nextHint?.()).toContain('REPEATED')
    })
  })
})
