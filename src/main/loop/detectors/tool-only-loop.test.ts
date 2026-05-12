import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ToolOnlyLoopDetector } from './tool-only-loop'
import type { OutcomeFacts } from '../outcome-facts'

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

describe('ToolOnlyLoopDetector', () => {
  it('有工具 + 无文本: 阈值 8 默认, 连续 8 次触发', () => {
    const d = new ToolOnlyLoopDetector()
    for (let i = 0; i < 7; i++) {
      expect(d.observe(facts({ hasToolCall: true, hasText: false })).triggered).toBe(false)
    }
    const v = d.observe(facts({ hasToolCall: true, hasText: false }))
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('tool_only_loop')
  })

  it('有文本 → reset 计数', () => {
    const d = new ToolOnlyLoopDetector({ limit: 3 })
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: false, hasText: true })) // reset
    expect(d.observe(facts({ hasToolCall: true, hasText: false })).triggered).toBe(false)
  })

  it('无工具 + 无文本 (empty_text) 不计数也不 reset', () => {
    const d = new ToolOnlyLoopDetector({ limit: 3 })
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false }))
    // 穿插一步 empty: 不 reset, 不 bump
    expect(d.observe(facts({ hasToolCall: false, hasText: false })).triggered).toBe(false)
    // 再有工具无文本 → bump → 触发 (limit=3)
    expect(d.observe(facts({ hasToolCall: true, hasText: false })).triggered).toBe(true)
  })

  it('opts.limit 覆盖默认 8', () => {
    const d = new ToolOnlyLoopDetector({ limit: 2 })
    expect(d.observe(facts({ hasToolCall: true, hasText: false })).triggered).toBe(false)
    expect(d.observe(facts({ hasToolCall: true, hasText: false })).triggered).toBe(true)
  })
})
