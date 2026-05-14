// src/main/loop/detectors/continuation-chain.test.ts
//
// 防 pending_continuation 滥用 detector 行为测试。
//
// 覆盖:
//   - 单次 emit 不触发
//   - 连续 2 次:不触发但 nextHint 给警告
//   - 连续 3 次 (default limit):triggered → break + 'continuation_chain' exit
//   - 中间穿插 tool call → chain reset
//   - 中间穿插 done block → chain reset
//   - 无 raw context → 静默 (向后兼容)

import { describe, it, expect, beforeEach } from 'vitest'
import { ContinuationChainDetector } from './continuation-chain'
import type { OutcomeFacts } from '../outcome-facts'

const fact = (over: Partial<OutcomeFacts> = {}): OutcomeFacts => ({
  hasToolCall: false,
  hasText: true,
  allToolsFailed: null,
  isSubagentFailure: false,
  signature: '',
  ...over,
})

const PENDING_TEXT = '现在写入文档:\n\n```talor\n{"type":"pending_continuation"}\n```'

const DONE_TEXT = '```talor\n{"type":"done","summary":"all set"}\n```'

const PLAIN_TEXT = 'just some text without any block'

describe('ContinuationChainDetector', () => {
  let detector: ContinuationChainDetector

  beforeEach(() => {
    detector = new ContinuationChainDetector()
  })

  it('单次 pending_continuation → 不触发', () => {
    const v = detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    expect(v.triggered).toBe(false)
    expect(detector.nextHint()).toBeNull()
  })

  it('连续 2 次 pending_continuation → 不触发但 nextHint 警告', () => {
    detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    const v = detector.observe(fact(), 1, { stepText: PENDING_TEXT })
    expect(v.triggered).toBe(false)
    const hint = detector.nextHint()
    expect(hint).not.toBeNull()
    expect(hint!).toMatch(/2 time\(s\) consecutively/)
    expect(hint!).toMatch(/next pending_continuation/)
  })

  it('连续 3 次 → triggered + continuation_chain', () => {
    detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    detector.observe(fact(), 1, { stepText: PENDING_TEXT })
    const v = detector.observe(fact(), 2, { stepText: PENDING_TEXT })
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('continuation_chain')
    expect(v.markFinal).toBe(true)
  })

  it('中间有 tool call → chain reset,再两次也不触发', () => {
    detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    detector.observe(fact(), 1, { stepText: PENDING_TEXT })
    // tool call → reset
    detector.observe(fact({ hasToolCall: true }), 2, { stepText: '' })
    // 再来 2 次只是 chain=1, chain=2
    const v1 = detector.observe(fact(), 3, { stepText: PENDING_TEXT })
    const v2 = detector.observe(fact(), 4, { stepText: PENDING_TEXT })
    expect(v1.triggered).toBe(false)
    expect(v2.triggered).toBe(false)
  })

  it('中间有 done block → chain reset', () => {
    detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    detector.observe(fact(), 1, { stepText: PENDING_TEXT })
    // done block → reset
    detector.observe(fact(), 2, { stepText: DONE_TEXT })
    // 再来 2 次,chain=1 → 不触发
    const v = detector.observe(fact(), 3, { stepText: PENDING_TEXT })
    expect(v.triggered).toBe(false)
  })

  it('普通文本不影响 chain (不计数也不 reset)', () => {
    detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    detector.observe(fact(), 1, { stepText: PLAIN_TEXT })
    const v = detector.observe(fact(), 2, { stepText: PENDING_TEXT })
    // chain 仍为 1 (PLAIN_TEXT 不影响) → 第 2 次 PENDING → chain=2 → 不触发
    expect(v.triggered).toBe(false)
  })

  it('无 raw context → 静默 (向后兼容)', () => {
    const v = detector.observe(fact())
    expect(v.triggered).toBe(false)
  })

  it('自定义 limit=2 → 第 2 次即 triggered', () => {
    const d = new ContinuationChainDetector({ limit: 2 })
    d.observe(fact(), 0, { stepText: PENDING_TEXT })
    const v = d.observe(fact(), 1, { stepText: PENDING_TEXT })
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('continuation_chain')
  })

  it('triggered 后 chain 被 reset (防同 session 错误复用)', () => {
    detector.observe(fact(), 0, { stepText: PENDING_TEXT })
    detector.observe(fact(), 1, { stepText: PENDING_TEXT })
    detector.observe(fact(), 2, { stepText: PENDING_TEXT }) // triggered
    // 再次 emit,chain 应该回到 1
    const v = detector.observe(fact(), 3, { stepText: PENDING_TEXT })
    expect(v.triggered).toBe(false)
  })
})
