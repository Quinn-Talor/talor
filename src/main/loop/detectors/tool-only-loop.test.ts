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
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: '',
    ...overrides,
  }
}

describe('ToolOnlyLoopDetector (v4.1 软提示, 不再 break)', () => {
  it('observe 永远返回 triggered=false (不再硬切断)', () => {
    const d = new ToolOnlyLoopDetector({ hintAt: 3 })
    for (let i = 0; i < 20; i++) {
      const v = d.observe(facts({ hasToolCall: true, hasText: false }))
      expect(v.triggered).toBe(false)
    }
  })

  it('counter < hintAt: nextHint 返 null', () => {
    const d = new ToolOnlyLoopDetector({ hintAt: 3 })
    d.observe(facts({ hasToolCall: true, hasText: false })) // 1
    expect(d.nextHint?.()).toBeNull()
    d.observe(facts({ hasToolCall: true, hasText: false })) // 2
    expect(d.nextHint?.()).toBeNull()
  })

  it('counter ≥ hintAt: nextHint 返非空提示, 含 progress-report / 并行 / answer now', () => {
    const d = new ToolOnlyLoopDetector({ hintAt: 3 })
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false })) // 3 — 达到阈值
    const hint = d.nextHint?.()
    expect(hint).not.toBeNull()
    expect(hint).toContain('progress-report needed')
    expect(hint).toContain('PARALLEL tool calls')
    expect(hint).toContain('ANSWER NOW')
  })

  it('有文本 → reset → hint 消失', () => {
    const d = new ToolOnlyLoopDetector({ hintAt: 3 })
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false }))
    expect(d.nextHint?.()).not.toBeNull()
    d.observe(facts({ hasToolCall: true, hasText: true })) // reset
    expect(d.nextHint?.()).toBeNull()
  })

  it('无工具无文本 (empty_text) 不计数也不 reset', () => {
    const d = new ToolOnlyLoopDetector({ hintAt: 3 })
    d.observe(facts({ hasToolCall: true, hasText: false })) // 1
    d.observe(facts({ hasToolCall: true, hasText: false })) // 2
    // 穿插 empty: 既不 reset 也不 bump
    d.observe(facts({ hasToolCall: false, hasText: false }))
    expect(d.nextHint?.()).toBeNull() // 还是 2 < 3
    d.observe(facts({ hasToolCall: true, hasText: false })) // 3 — 达到阈值
    expect(d.nextHint?.()).not.toBeNull()
  })

  it('默认 hintAt=3', () => {
    const d = new ToolOnlyLoopDetector()
    d.observe(facts({ hasToolCall: true, hasText: false }))
    d.observe(facts({ hasToolCall: true, hasText: false }))
    expect(d.nextHint?.()).toBeNull()
    d.observe(facts({ hasToolCall: true, hasText: false }))
    expect(d.nextHint?.()).not.toBeNull()
  })
})
