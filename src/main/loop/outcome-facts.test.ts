import { describe, it, expect } from 'vitest'
import { classify, hasTerminationMarker, TERMINATION_MARKERS } from './outcome-facts'
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

describe('hasTerminationMarker', () => {
  it('✓ Done → true', () => {
    expect(hasTerminationMarker('task complete\n\n✓ Done')).toBe(true)
  })

  it('❓ Need input → true', () => {
    expect(hasTerminationMarker('I need workspace id\n❓ Need input — provide path')).toBe(true)
  })

  it('⏸ Blocked → true', () => {
    expect(hasTerminationMarker('⏸ Blocked — missing API key')).toBe(true)
  })

  it('marker 出现在文本中间也算', () => {
    expect(hasTerminationMarker('start ✓ Done end')).toBe(true)
  })

  it('完全无 marker → false', () => {
    expect(hasTerminationMarker('plain text without any marker')).toBe(false)
  })

  it('空字符串 → false', () => {
    expect(hasTerminationMarker('')).toBe(false)
  })

  it('"已完成" (中文同义) 不匹配 (严格 includes 设计)', () => {
    // 这是有意的: 接受少量假阴, 防止 fuzzy 匹配把"已完成 (无 ✓)"误判为有 marker
    expect(hasTerminationMarker('任务已完成')).toBe(false)
  })

  it('exports three markers in correct order', () => {
    expect(TERMINATION_MARKERS).toEqual(['✓ Done', '❓ Need input', '⏸ Blocked'])
  })
})

describe('classify', () => {
  it('无工具 + 有 text + 有 marker → 标识正确', () => {
    const outcome = makeOutcome({ stepText: 'done\n\n✓ Done', toolNames: [] })
    const facts = classify(outcome)
    expect(facts.hasToolCall).toBe(false)
    expect(facts.hasText).toBe(true)
    expect(facts.hasMarker).toBe(true)
    expect(facts.noMarkerExit).toBe(false)
  })

  it('无工具 + 有 text + 无 marker + exitReason=no_tool_calls_no_marker → noMarkerExit=true (Fix C 信号)', () => {
    const outcome = makeOutcome({
      stepText: 'preparing to start',
      toolNames: [],
      exitReason: 'no_tool_calls_no_marker',
    })
    const facts = classify(outcome)
    expect(facts.hasText).toBe(true)
    expect(facts.hasMarker).toBe(false)
    expect(facts.noMarkerExit).toBe(true)
  })

  it('有工具 + 无 text → hasToolCall=true, hasText=false', () => {
    const outcome = makeOutcome({ toolNames: ['read', 'write'], stepText: '' })
    const facts = classify(outcome)
    expect(facts.hasToolCall).toBe(true)
    expect(facts.hasText).toBe(false)
  })

  it('allToolsFailed 三态原样透传', () => {
    expect(classify(makeOutcome({ allToolsFailed: null })).allToolsFailed).toBe(null)
    expect(classify(makeOutcome({ allToolsFailed: true })).allToolsFailed).toBe(true)
    expect(classify(makeOutcome({ allToolsFailed: false })).allToolsFailed).toBe(false)
  })

  it('isSubagentFailure 从 containsSubagentFailure 取', () => {
    expect(classify(makeOutcome({ containsSubagentFailure: true })).isSubagentFailure).toBe(true)
    expect(classify(makeOutcome({ containsSubagentFailure: false })).isSubagentFailure).toBe(false)
  })

  it('signature 原样透传', () => {
    expect(classify(makeOutcome({ signature: 'read#abc:def' })).signature).toBe('read#abc:def')
    expect(classify(makeOutcome({ signature: '' })).signature).toBe('')
  })

  it('stepText 仅含空白 → hasText=false', () => {
    expect(classify(makeOutcome({ stepText: '   \n\t  ' })).hasText).toBe(false)
  })
})
