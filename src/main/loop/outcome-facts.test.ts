import { describe, it, expect } from 'vitest'
import { classify } from './outcome-facts'
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

describe('classify (v3.7.1 瘦身后 — 仅维度 A 信号)', () => {
  it('无工具 + 有 text → hasToolCall=false, hasText=true', () => {
    const facts = classify(makeOutcome({ stepText: 'done', toolNames: [] }))
    expect(facts.hasToolCall).toBe(false)
    expect(facts.hasText).toBe(true)
  })

  it('有工具 + 无 text → hasToolCall=true, hasText=false', () => {
    const facts = classify(makeOutcome({ toolNames: ['read', 'write'], stepText: '' }))
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

  // v3.7.1: 删除字段 — 不应在 facts 上存在
  it('已删除字段不再 派生', () => {
    const factsRaw = classify(
      makeOutcome({ stepText: '```talor\n{"type":"done"}\n```' }),
    ) as unknown as Record<string, unknown>
    expect(factsRaw.hasMarker).toBeUndefined()
    expect(factsRaw.hasTermination).toBeUndefined()
    expect(factsRaw.hasDone).toBeUndefined()
    expect(factsRaw.hasNeedInput).toBeUndefined()
    expect(factsRaw.hasBlocked).toBeUndefined()
    expect(factsRaw.hasPendingConfirm).toBeUndefined()
    expect(factsRaw.hasWarning).toBeUndefined()
    expect(factsRaw.hasLegacyMarker).toBeUndefined()
    expect(factsRaw.blocks).toBeUndefined()
    expect(factsRaw.invalidBlocks).toBeUndefined()
    expect(factsRaw.toolNames).toBeUndefined()
  })
})
