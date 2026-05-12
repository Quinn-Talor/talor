import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { SignatureDeadLoopDetector } from './signature-dead-loop'
import type { OutcomeFacts } from '../outcome-facts'

function facts(overrides: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: true,
    hasText: false,
    hasMarker: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: 'read#abc:def',
    noMarkerExit: false,
    ...overrides,
  }
}

describe('SignatureDeadLoopDetector', () => {
  it('无 signature → 不触发', () => {
    const d = new SignatureDeadLoopDetector()
    expect(d.observe(facts({ signature: '' })).triggered).toBe(false)
  })

  it('不同 signature → 不触发, 重置计数', () => {
    const d = new SignatureDeadLoopDetector()
    expect(d.observe(facts({ signature: 'a' })).triggered).toBe(false)
    expect(d.observe(facts({ signature: 'b' })).triggered).toBe(false)
    expect(d.observe(facts({ signature: 'a' })).triggered).toBe(false)
  })

  it('带 error 同签名连续 2 次 (阈值 1) → 第 2 次触发', () => {
    const d = new SignatureDeadLoopDetector()
    expect(d.observe(facts({ allToolsFailed: true })).triggered).toBe(false)
    const v = d.observe(facts({ allToolsFailed: true }))
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('repeated_error')
  })

  it('无 error 同签名 2 次 (阈值 2) → 仍不触发; 3 次才触发', () => {
    const d = new SignatureDeadLoopDetector()
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(true)
  })

  it('无 signature (中间步) 不 reset 计数', () => {
    const d = new SignatureDeadLoopDetector()
    d.observe(facts({ signature: 'a', allToolsFailed: true })) // count=0
    // 穿插一步无工具调用
    expect(d.observe(facts({ signature: '' })).triggered).toBe(false)
    // 再来同签名 → 应当触发 (阈值 1)
    expect(d.observe(facts({ signature: 'a', allToolsFailed: true })).triggered).toBe(true)
  })

  it('opts.noErrorThreshold 覆盖默认阈值', () => {
    const d = new SignatureDeadLoopDetector({ noErrorThreshold: 1 })
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(true) // 第 2 次即触发
  })
})
