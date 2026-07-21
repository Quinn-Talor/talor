import { describe, it, expect } from 'vitest'
import { parseAsOfMonth, cadenceOf, freshnessWindowMonths } from './freshness'

describe('parseAsOfMonth', () => {
  it('YYYY-MM / YYYY-MM-DD → 月序号', () => {
    expect(parseAsOfMonth('2026-03')).toBe(2026 * 12 + 2)
    expect(parseAsOfMonth('2026-03-31')).toBe(2026 * 12 + 2)
  })
  it('YYYY-Qn → 季末月', () => {
    expect(parseAsOfMonth('2026-Q2')).toBe(2026 * 12 + 5)
    expect(parseAsOfMonth('2026Q4')).toBe(2026 * 12 + 11)
  })
  it('年 / 年报 → 当年 12 月', () => {
    expect(parseAsOfMonth('2026')).toBe(2026 * 12 + 11)
    expect(parseAsOfMonth('2026-annual')).toBe(2026 * 12 + 11)
  })
  it('乱串 / 空 → null', () => {
    expect(parseAsOfMonth('暂缺')).toBeNull()
    expect(parseAsOfMonth('')).toBeNull()
  })
})

const series = (...as_of: string[]) => ({ series: as_of.map((a) => ({ as_of: a })) })

describe('cadenceOf(认准披露周期)', () => {
  it('显式 cadence 覆盖优先', () => {
    expect(cadenceOf({ cadence: 'quarterly', level: 'macro', ...series('2026-01') })).toBe(
      'quarterly',
    )
  })
  it('YYYY-MM-DD → daily', () => expect(cadenceOf(series('2026-07-01'))).toBe('daily'))
  it('YYYY-Qn → quarterly', () => expect(cadenceOf(series('2026-Q1'))).toBe('quarterly'))
  it('月份全 ∈{3,6,9,12} → quarterly', () =>
    expect(cadenceOf(series('2025-12', '2026-03', '2026-06'))).toBe('quarterly'))
  it('YYYY-MM + level=macro → monthly', () =>
    expect(cadenceOf({ level: 'macro', ...series('2026-05') })).toBe('monthly'))
  it('YYYY-MM + level=company(非季末月)→ quarterly', () =>
    expect(cadenceOf({ level: 'company', ...series('2026-05') })).toBe('quarterly'))
  it('纯年 → annual', () => expect(cadenceOf(series('2025', '2026'))).toBe('annual'))
  it('无可解析 → annual(保守)', () => expect(cadenceOf(series('暂缺'))).toBe('annual'))
})

describe('freshnessWindowMonths', () => {
  it('各 cadence 窗', () => {
    expect(freshnessWindowMonths(series('2026-Q1'))).toBe(5) // quarterly
    expect(freshnessWindowMonths({ level: 'macro', ...series('2026-05') })).toBe(2) // monthly
    expect(freshnessWindowMonths(series('2026'))).toBe(16) // annual
    expect(freshnessWindowMonths({ cadence: 'irregular', ...series('2026-05') })).toBeNull()
    expect(freshnessWindowMonths(series('2026-07-01'))).toBe(1) // daily
  })
})
