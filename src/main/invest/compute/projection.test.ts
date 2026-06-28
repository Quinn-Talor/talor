import { describe, it, expect } from 'vitest'
import { computeProjection } from './projection'

describe('computeProjection', () => {
  it('单年: 营收×增长×份额×净利率÷股本 = EPS', () => {
    const r = computeProjection({
      base_revenue: 1000,
      industry_growth_pct: 15,
      share_delta_pct: 5,
      net_margin_pct: 12,
      shares: 100,
    })
    // 营收 = 1000×1.15×1.05 = 1207.5;净利 = ×0.12 = 144.9;EPS = /100 = 1.449
    expect(r.years).toHaveLength(1)
    expect(r.end_eps).toBeCloseTo(1.449, 6)
  })

  it('多年: 复合增长 + eps_cagr', () => {
    const r = computeProjection({
      base_revenue: 1000,
      industry_growth_pct: 20,
      share_delta_pct: 0,
      net_margin_pct: 10,
      shares: 100,
      horizon_years: 3,
    })
    expect(r.years).toHaveLength(3)
    expect(r.eps_cagr).toBeCloseTo(0.2, 6) // 纯营收复合 20% → EPS 也复合 20%
  })

  it('丢份额: share_delta 负 → 增速被打折', () => {
    const r = computeProjection({
      base_revenue: 1000,
      industry_growth_pct: 20,
      share_delta_pct: -10,
      net_margin_pct: 10,
      shares: 100,
    })
    // 营收 = 1000×1.2×0.9 = 1080 < 1200
    expect(r.years![0].revenue).toBeCloseTo(1080, 6)
  })

  it('不触发: 股本≤0 → null', () => {
    const r = computeProjection({
      base_revenue: 1000,
      industry_growth_pct: 15,
      share_delta_pct: 5,
      net_margin_pct: 12,
      shares: 0,
    })
    expect(r.years).toBeNull()
    expect(r.end_eps).toBeNull()
  })

  it('不触发: 基期 EPS≤0(净利率负)→ eps_cagr null', () => {
    const r = computeProjection({
      base_revenue: 1000,
      industry_growth_pct: 15,
      share_delta_pct: 0,
      net_margin_pct: -5,
      shares: 100,
      horizon_years: 2,
    })
    expect(r.eps_cagr).toBeNull()
  })

  it('可复现: 同输入两次一致', () => {
    const inp = {
      base_revenue: 1000,
      industry_growth_pct: 15,
      share_delta_pct: 5,
      net_margin_pct: 12,
      shares: 100,
      horizon_years: 3,
    }
    expect(computeProjection(inp)).toEqual(computeProjection(inp))
  })
})
