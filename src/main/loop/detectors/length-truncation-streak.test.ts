// src/main/loop/detectors/length-truncation-streak.test.ts
//
// 防 finishReason='length' 死循环兜底测试。

import { describe, it, expect, beforeEach } from 'vitest'
import { LengthTruncationStreakDetector } from './length-truncation-streak'
import type { FinishReason } from 'ai'
import type { OutcomeFacts } from '../outcome-facts'

const fact = (over: Partial<OutcomeFacts> = {}): OutcomeFacts => ({
  hasToolCall: false,
  hasText: true,
  allToolsFailed: null,
  isSubagentFailure: false,
  signature: '',
  ...over,
})

const rawWith = (finishReason?: FinishReason) => ({ stepText: 'x', finishReason })

describe('LengthTruncationStreakDetector', () => {
  let detector: LengthTruncationStreakDetector

  beforeEach(() => {
    detector = new LengthTruncationStreakDetector()
  })

  it('单次 length → 不触发', () => {
    const v = detector.observe(fact(), 0, rawWith('length'))
    expect(v.triggered).toBe(false)
    expect(detector.nextHint()).toBeNull()
  })

  it('连续 2 次 length → 不触发但 nextHint 警告', () => {
    detector.observe(fact(), 0, rawWith('length'))
    const v = detector.observe(fact(), 1, rawWith('length'))
    expect(v.triggered).toBe(false)
    const hint = detector.nextHint()
    expect(hint).not.toBeNull()
    expect(hint!).toMatch(/truncated/)
    expect(hint!).toMatch(/WRITE TOOL/)
  })

  it('连续 3 次 length → triggered + continuation_chain', () => {
    detector.observe(fact(), 0, rawWith('length'))
    detector.observe(fact(), 1, rawWith('length'))
    const v = detector.observe(fact(), 2, rawWith('length'))
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('continuation_chain')
    expect(v.markFinal).toBe(true)
  })

  it('finishReason="stop" 后 reset', () => {
    detector.observe(fact(), 0, rawWith('length'))
    detector.observe(fact(), 1, rawWith('length'))
    detector.observe(fact(), 2, rawWith('stop')) // reset
    const v = detector.observe(fact(), 3, rawWith('length'))
    expect(v.triggered).toBe(false)
  })

  it('finishReason="tool-calls" 后 reset', () => {
    detector.observe(fact(), 0, rawWith('length'))
    detector.observe(fact(), 1, rawWith('length'))
    detector.observe(fact(), 2, rawWith('tool-calls')) // reset
    const v = detector.observe(fact(), 3, rawWith('length'))
    expect(v.triggered).toBe(false)
  })

  it('无 finishReason → 静默 (向后兼容)', () => {
    const v1 = detector.observe(fact(), 0, { stepText: 'x' })
    const v2 = detector.observe(fact())
    expect(v1.triggered).toBe(false)
    expect(v2.triggered).toBe(false)
  })

  it('自定义 limit=2 → 第 2 次即 triggered', () => {
    const d = new LengthTruncationStreakDetector({ limit: 2 })
    d.observe(fact(), 0, rawWith('length'))
    const v = d.observe(fact(), 1, rawWith('length'))
    expect(v.triggered).toBe(true)
  })

  it('triggered 后 chain 被 reset (防同 session 错误复用)', () => {
    detector.observe(fact(), 0, rawWith('length'))
    detector.observe(fact(), 1, rawWith('length'))
    detector.observe(fact(), 2, rawWith('length')) // triggered
    const v = detector.observe(fact(), 3, rawWith('length'))
    expect(v.triggered).toBe(false)
  })
})
