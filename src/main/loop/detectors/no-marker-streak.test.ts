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

  it('连续 5 次 noMarkerExit (默认 limit) → 第 5 次触发', () => {
    const d = new NoMarkerStreakDetector(stubCtx)
    for (let i = 0; i < 4; i++) {
      expect(d.observe(facts({ noMarkerExit: true }), i).triggered).toBe(false)
    }
    const v = d.observe(facts({ noMarkerExit: true }), 4)
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

  describe('渐进式 hint (B 修复)', () => {
    it('count=0 → null', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      expect(d.nextHint?.()).toBeNull()
    })

    it('count=1 → PENDING_MARKER_HINT (温和提醒)', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      d.observe(facts({ noMarkerExit: true }), 0)
      const hint = d.nextHint?.()
      expect(hint).toContain('[Turn-end check]')
      expect(hint).not.toContain('REPEATED')
    })

    it('count=2 → PENDING_MARKER_HINT (温和)', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      d.observe(facts({ noMarkerExit: true }), 0)
      d.observe(facts({ noMarkerExit: true }), 1)
      const hint = d.nextHint?.()
      expect(hint).toContain('[Turn-end check]')
      expect(hint).not.toContain('REPEATED')
    })

    it('count=3 → STRONG_MARKER_HINT (强化警告 + 反 DSML markup)', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      d.observe(facts({ noMarkerExit: true }), 0)
      d.observe(facts({ noMarkerExit: true }), 1)
      d.observe(facts({ noMarkerExit: true }), 2)
      const hint = d.nextHint?.()
      expect(hint).toContain('REPEATED')
      expect(hint).toContain('DSML')
      expect(hint).toContain('will be stripped')
    })

    it('count=4 → STRONG_MARKER_HINT (临近触发)', () => {
      const d = new NoMarkerStreakDetector(stubCtx)
      for (let i = 0; i < 4; i++) d.observe(facts({ noMarkerExit: true }), i)
      expect(d.nextHint?.()).toContain('REPEATED')
    })
  })
})
