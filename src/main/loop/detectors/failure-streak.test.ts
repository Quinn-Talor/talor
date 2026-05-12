import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockRunForcedSummary } = vi.hoisted(() => ({
  mockRunForcedSummary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../forced-summary', () => ({
  runForcedSummary: mockRunForcedSummary,
  failureStreakSummaryOpts: vi.fn((c: number) => ({ label: `[fs-${c}]` })),
}))

import { FailureStreakDetector } from './failure-streak'
import type { OutcomeFacts } from '../outcome-facts'
import type { ForcedSummaryCtx } from '../forced-summary'

function facts(overrides: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: true,
    hasText: false,
    hasMarker: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: '',
    noMarkerExit: false,
    toolNames: [],
    blocks: [],
    invalidBlocks: [],
    hasDone: false,
    hasNeedInput: false,
    hasBlocked: false,
    hasPendingConfirm: false,
    hasWarning: false,
    hasLegacyMarker: false,
    hasTermination: false,
    ...overrides,
  }
}

const stubCtx = {} as ForcedSummaryCtx

describe('FailureStreakDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allToolsFailed=null (无工具调用) → 不触发, 不影响计数', () => {
    const d = new FailureStreakDetector(stubCtx)
    expect(d.observe(facts({ allToolsFailed: null }), 0).triggered).toBe(false)
  })

  it('allToolsFailed=true 连续 3 次 → 第 3 次触发', () => {
    const d = new FailureStreakDetector(stubCtx)
    expect(d.observe(facts({ allToolsFailed: true }), 0).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: true }), 1).triggered).toBe(false)
    const v = d.observe(facts({ allToolsFailed: true }), 2)
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('repeated_error')
    expect(v.markFinal).toBe(true)
    expect(v.runSummary).toBeDefined()
  })

  it('subagent 失败加权 +2: 2 次即触发', () => {
    const d = new FailureStreakDetector(stubCtx)
    expect(d.observe(facts({ allToolsFailed: true, isSubagentFailure: true }), 0).triggered).toBe(
      false,
    )
    expect(d.observe(facts({ allToolsFailed: true, isSubagentFailure: true }), 1).triggered).toBe(
      true,
    )
  })

  it('allToolsFailed=false (至少一成功) → reset 计数', () => {
    const d = new FailureStreakDetector(stubCtx)
    d.observe(facts({ allToolsFailed: true }), 0)
    d.observe(facts({ allToolsFailed: true }), 1)
    d.observe(facts({ allToolsFailed: false }), 2) // reset
    expect(d.observe(facts({ allToolsFailed: true }), 3).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: true }), 4).triggered).toBe(false)
  })

  it('verdict.runSummary 调用 forced summary', async () => {
    const d = new FailureStreakDetector(stubCtx)
    d.observe(facts({ allToolsFailed: true }), 0)
    d.observe(facts({ allToolsFailed: true }), 1)
    const v = d.observe(facts({ allToolsFailed: true }), 2)
    await v.runSummary!()
    expect(mockRunForcedSummary).toHaveBeenCalledTimes(1)
  })

  it('nextHint: streak == limit-1 时返回警告 hint', () => {
    const d = new FailureStreakDetector(stubCtx)
    expect(d.nextHint?.()).toBeNull()
    d.observe(facts({ allToolsFailed: true }), 0) // count=1
    expect(d.nextHint?.()).toBeNull()
    d.observe(facts({ allToolsFailed: true }), 1) // count=2 = limit-1
    expect(d.nextHint?.()).toContain('[failure-streak warning]')
  })
})
