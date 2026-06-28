import { describe, it, expect } from 'vitest'
import { computeDupont } from './dupont'

describe('computeDupont', () => {
  it('三因子乘积 = ROE = 净利润/净资产', () => {
    const r = computeDupont({ net_income: 18, revenue: 100, total_assets: 200, equity: 100 })
    expect(r.net_margin).toBeCloseTo(0.18, 6)
    expect(r.asset_turnover).toBeCloseTo(0.5, 6)
    expect(r.equity_multiplier).toBeCloseTo(2, 6)
    expect(r.roe).toBeCloseTo(0.18, 6) // = 18/100
  })

  it('主驱动识别: 高杠杆型 → leverage', () => {
    // 乘数−1=3 远大于净利率0.05、周转0.6 → 杠杆驱动
    const r = computeDupont({ net_income: 5, revenue: 100, total_assets: 400, equity: 100 })
    expect(r.driver).toBe('leverage')
  })

  it('主驱动识别: 高周转型 → turnover', () => {
    const r = computeDupont({ net_income: 3, revenue: 100, total_assets: 50, equity: 40 })
    // 周转=2 最大,净利率0.03,乘数−1=0.25
    expect(r.driver).toBe('turnover')
  })

  it('不触发: 分母为 0 → 对应比率 null,ROE null,driver null', () => {
    const r = computeDupont({ net_income: 10, revenue: 0, total_assets: 100, equity: 50 })
    expect(r.net_margin).toBeNull()
    expect(r.roe).toBeNull()
    expect(r.driver).toBeNull()
  })

  it('不触发: NaN 输入 → null', () => {
    const r = computeDupont({ net_income: NaN, revenue: 100, total_assets: 200, equity: 100 })
    expect(r.net_margin).toBeNull()
    expect(r.roe).toBeNull()
  })

  it('可复现: 同输入两次一致', () => {
    const inp = { net_income: 18, revenue: 100, total_assets: 200, equity: 100 }
    expect(computeDupont(inp)).toEqual(computeDupont(inp))
  })
})
