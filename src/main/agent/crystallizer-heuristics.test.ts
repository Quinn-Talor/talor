// crystallizer-heuristics.test.ts — mode 推荐 + 切换检测
import { describe, it, expect } from 'vitest'
import { recommendMode, detectModeSwitch } from './crystallizer-heuristics'

describe('recommendMode', () => {
  it('recommends express when chat is short and clean', () => {
    const r = recommendMode({ turnCount: 8, failureCount: 0 })
    expect(r.mode).toBe('express')
  })

  it('recommends guided when chat exceeds turn threshold', () => {
    const r = recommendMode({ turnCount: 50, failureCount: 0 })
    expect(r.mode).toBe('guided')
    expect(r.reasons.some((rsn) => rsn.includes('对话较长'))).toBe(true)
  })

  it('recommends guided when failure count is high', () => {
    const r = recommendMode({ turnCount: 10, failureCount: 8 })
    expect(r.mode).toBe('guided')
    expect(r.reasons.some((rsn) => rsn.includes('失败次数较多'))).toBe(true)
  })

  it('recommends guided when multiple workflow candidates', () => {
    const r = recommendMode({ turnCount: 10, workflowCandidateCount: 3 })
    expect(r.mode).toBe('guided')
    expect(r.reasons.some((rsn) => rsn.includes('候选工作流'))).toBe(true)
  })

  it('recommends guided for first-time exporter', () => {
    const r = recommendMode({ turnCount: 5, hasPriorExports: false })
    expect(r.mode).toBe('guided')
    expect(r.reasons.some((rsn) => rsn.includes('首次'))).toBe(true)
  })

  it('returns reason even for express recommendation', () => {
    const r = recommendMode({ turnCount: 5, failureCount: 0 })
    expect(r.mode).toBe('express')
    expect(r.reasons.length).toBeGreaterThan(0)
  })
})

describe('detectModeSwitch', () => {
  it('returns null for empty / unrelated text', () => {
    expect(detectModeSwitch('')).toBeNull()
    expect(detectModeSwitch('好的')).toBeNull()
    expect(detectModeSwitch('继续干吧')).toBeNull()
  })

  it.each([
    ['express', 'express'],
    ['EXPRESS', 'express'],
    ['直接给完整草稿', 'express'],
    ['直接给草稿', 'express'],
    ['快一点', 'express'],
    ['一次性给我', 'express'],
  ])('detects %s → express', (input, expected) => {
    expect(detectModeSwitch(input)).toBe(expected)
  })

  it.each([
    ['guided', 'guided'],
    ['分步', 'guided'],
    ['分步走', 'guided'],
    ['走一步看一步', 'guided'],
    ['一段一段确认', 'guided'],
    ['逐段讨论', 'guided'],
  ])('detects %s → guided', (input, expected) => {
    expect(detectModeSwitch(input)).toBe(expected)
  })

  it('handles non-string defensively', () => {
    expect(detectModeSwitch(undefined as unknown as string)).toBeNull()
    expect(detectModeSwitch(null as unknown as string)).toBeNull()
  })
})
