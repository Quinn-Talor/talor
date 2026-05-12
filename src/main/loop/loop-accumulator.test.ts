import { describe, it, expect } from 'vitest'
import { LoopAccumulator } from './loop-accumulator'
import type { StepOutcome } from './types'

function makeOutcome(overrides: Partial<StepOutcome> = {}): StepOutcome {
  return {
    stepText: '',
    wroteAssistantFinal: false,
    shouldContinue: true,
    durationMs: 0,
    toolNames: [],
    signature: '',
    allToolsFailed: null,
    containsSubagentFailure: false,
    ...overrides,
  }
}

describe('LoopAccumulator', () => {
  it('初始状态', () => {
    const acc = new LoopAccumulator()
    expect(acc.totalSteps).toBe(0)
    expect(acc.totalToolCalls).toBe(0)
    expect(acc.fullTextLength).toBe(0)
    expect(acc.wroteAssistantFinal).toBe(false)
    expect(acc.needsFallback()).toBe(true)
  })

  it('observe 累计 stats', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ stepText: 'hello', toolNames: ['read', 'write'] }))
    expect(acc.totalSteps).toBe(1)
    expect(acc.totalToolCalls).toBe(2)
    expect(acc.fullTextLength).toBe(5)
  })

  it('多步累计 stepText 拼接', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ stepText: 'foo' }))
    acc.observe(makeOutcome({ stepText: 'bar' }))
    expect(acc.fullTextLength).toBe(6)
  })

  it('outcome.wroteAssistantFinal=true → 累积单向开关', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ wroteAssistantFinal: true }))
    expect(acc.wroteAssistantFinal).toBe(true)
    // 后续即便 outcome 不带 final 也保持 true
    acc.observe(makeOutcome({ wroteAssistantFinal: false }))
    expect(acc.wroteAssistantFinal).toBe(true)
  })

  it('markFinal 显式标记 (forced summary 路径)', () => {
    const acc = new LoopAccumulator()
    acc.markFinal()
    expect(acc.wroteAssistantFinal).toBe(true)
  })

  it('needsFallback: 没写 final 且 fullText 空 → true', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ stepText: '', wroteAssistantFinal: false }))
    expect(acc.needsFallback()).toBe(true)
  })

  it('needsFallback: 有 final → false', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ wroteAssistantFinal: true }))
    expect(acc.needsFallback()).toBe(false)
  })

  it('needsFallback: 有 fullText → false', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ stepText: 'something' }))
    expect(acc.needsFallback()).toBe(false)
  })

  it('buildReport 含 steps / total / exit reason / tools', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ stepText: 'x', toolNames: ['a', 'b', 'a'] }))
    acc.observe(makeOutcome({ stepText: 'y', toolNames: ['c'] }))
    const r = acc.buildReport(1234, 'no_tool_calls')
    expect(r.summary).toContain('steps: 2')
    expect(r.summary).toContain('total: 1.2s')
    expect(r.summary).toContain('exit: no_tool_calls')
    expect(r.detail).toContain('tools: 4 calls')
    // 工具名去重
    expect(r.detail).toContain('a, b, c')
  })

  it('buildReport: 无工具调用时 tools 列出 "none"', () => {
    const acc = new LoopAccumulator()
    acc.observe(makeOutcome({ stepText: 'just text' }))
    expect(acc.buildReport(500, 'no_tool_calls').detail).toContain('[none]')
  })
})
