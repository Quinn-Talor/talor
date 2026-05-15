import { describe, it, expect } from 'vitest'
import { summarizeTrajectory } from './trajectory'
import type { StepOutcome } from '../types'

function step(overrides: Partial<StepOutcome> = {}): StepOutcome {
  return {
    stepText: '',
    wroteAssistantFinal: false,
    shouldContinue: false,
    durationMs: 0,
    toolNames: [],
    signature: '',
    allToolsFailed: null,
    containsSubagentFailure: false,
    ...overrides,
  }
}

describe('summarizeTrajectory', () => {
  it('空数组 → 空串', () => {
    expect(summarizeTrajectory([])).toBe('')
  })

  it('单步纯文本格式: [0] text | no-tools | finish=stop', () => {
    const out = summarizeTrajectory([step({ stepText: 'hello world', finishReason: 'stop' })])
    expect(out).toMatch(/^\[0\] hello world \| no-tools \| finish=stop$/)
  })

  it('单步工具 + 多步索引', () => {
    const out = summarizeTrajectory([
      step({ stepText: 'reading', toolNames: ['read'], finishReason: 'tool-calls' }),
      step({ stepText: 'done', finishReason: 'stop' }),
    ])
    expect(out).toContain('[0] reading | tools=[read] | finish=tool-calls')
    expect(out).toContain('[1] done | no-tools | finish=stop')
  })

  it('allToolsFailed=true → 标注 ALL_FAILED', () => {
    const out = summarizeTrajectory([
      step({ stepText: 'err', toolNames: ['bash'], allToolsFailed: true }),
    ])
    expect(out).toMatch(/ALL_FAILED/)
  })

  it('text 截断 120 字符 + 换行替换空格', () => {
    const longText = 'a'.repeat(200)
    const out = summarizeTrajectory([step({ stepText: longText + '\nb' })])
    expect(out).toContain('a'.repeat(120))
    expect(out).not.toContain('\n')
  })

  it('finishReason 缺失 → ?', () => {
    const out = summarizeTrajectory([step({ stepText: 'x' })])
    expect(out).toMatch(/finish=\?/)
  })
})
