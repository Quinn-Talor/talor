import { describe, it, expect } from 'vitest'
import { computeTurnover } from './turnover'

describe('computeTurnover', () => {
  it('周转天数 = 天数 ÷(基数÷均值)', () => {
    // 均值=(100+140)/2=120;次数=600/120=5;天数=365/5=73
    const r = computeTurnover({ opening: 100, closing: 140, base: 600 })
    expect(r.avg_balance).toBe(120)
    expect(r.turnover_times).toBeCloseTo(5, 6)
    expect(r.turnover_days).toBeCloseTo(73, 6)
  })

  it('季度天数可传 90', () => {
    const r = computeTurnover({ opening: 100, closing: 100, base: 200, days: 90 })
    expect(r.turnover_days).toBeCloseTo(90 / (200 / 100), 6) // 次数=2,天数=45
  })

  it('不触发: 基数≤0 → 天数/次数 null', () => {
    const r = computeTurnover({ opening: 100, closing: 100, base: 0 })
    expect(r.turnover_days).toBeNull()
    expect(r.turnover_times).toBeNull()
  })

  it('不触发: NaN → 全 null', () => {
    const r = computeTurnover({ opening: NaN, closing: 100, base: 600 })
    expect(r.avg_balance).toBeNull()
    expect(r.turnover_days).toBeNull()
  })

  it('可复现: 同输入两次一致', () => {
    const inp = { opening: 100, closing: 140, base: 600 }
    expect(computeTurnover(inp)).toEqual(computeTurnover(inp))
  })
})
