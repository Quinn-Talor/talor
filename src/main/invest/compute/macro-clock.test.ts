import { describe, it, expect } from 'vitest'
import { computeMacroClock } from './macro-clock'

describe('computeMacroClock', () => {
  it('增长高+通胀低 → 复苏,利好股票,重配', () => {
    const r = computeMacroClock({
      growth: { pmi: 52, pmi_trend: 'up' },
      inflation: { ppi_trend: 'down' },
    })
    expect(r.growth).toBe('high')
    expect(r.inflation).toBe('low')
    expect(r.quadrant).toBe('复苏')
    expect(r.favored_asset).toBe('股票')
    expect(r.equity_stance).toBe('重配')
    expect(r.suggested_systemic).toBe('normal')
  })

  it('增长高+通胀高 → 过热,利好商品/周期', () => {
    const r = computeMacroClock({ growth: { pmi: 53 }, inflation: { ppi_trend: 'up' } })
    expect(r.quadrant).toBe('过热')
    expect(r.favored_asset).toBe('商品/周期')
  })

  it('增长低+通胀高 → 滞胀,利好现金,回避,systemic=warning', () => {
    const r = computeMacroClock({ growth: { pmi: 47 }, inflation: { ppi_trend: 'up' } })
    expect(r.quadrant).toBe('滞胀')
    expect(r.favored_asset).toBe('现金')
    expect(r.equity_stance).toBe('回避')
    expect(r.suggested_systemic).toBe('warning')
  })

  it('增长低+通胀低 → 衰退,利好债券', () => {
    const r = computeMacroClock({ growth: { pmi: 48 }, inflation: { ppi_trend: 'down' } })
    expect(r.quadrant).toBe('衰退')
    expect(r.favored_asset).toBe('债券')
  })

  it('外部宽松+北向流入+稳增长 → 态度上调一档(回避→标配)', () => {
    const r = computeMacroClock({
      growth: { pmi: 48 }, // 衰退基线 → 回避
      inflation: { ppi_trend: 'down' },
      liquidity: { rate: 'cut' },
      policy: { stance: 'stable_growth' },
      external: { fed: 'easing', northbound: 'inflow' },
    })
    expect(r.quadrant).toBe('衰退')
    expect(r.equity_stance).toBe('标配') // 回避 + loose>=2 → 上调
  })

  it('防风险 + 外部收紧 → 态度下调(复苏→标配)', () => {
    const r = computeMacroClock({
      growth: { pmi: 52 },
      inflation: { ppi_trend: 'down' },
      policy: { stance: 'risk_control' },
      external: { fed: 'tightening', northbound: 'outflow' },
    })
    expect(r.quadrant).toBe('复苏')
    expect(r.equity_stance).toBe('标配') // 重配 - 下调
  })

  it('缺增长或通胀 → 无法定位象限(null)', () => {
    expect(computeMacroClock({ growth: { pmi: 52 } }).quadrant).toBeNull()
    expect(computeMacroClock({}).quadrant).toBeNull()
  })

  it('可复现', () => {
    const inp = { growth: { pmi: 52 }, inflation: { ppi_trend: 'down' as const } }
    expect(computeMacroClock(inp)).toEqual(computeMacroClock(inp))
  })
})
