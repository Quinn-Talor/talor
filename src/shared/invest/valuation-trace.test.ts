import { describe, it, expect } from 'vitest'
import { computeValuationTrace, METHOD_PARAMS, type TraceAssumption } from './valuation-trace'

// 全 pe 参数集(比亚迪示意:命门 high 撑三档,支撑参数固定 base)
const PE: TraceAssumption[] = [
  { key: 'ev_pen', bear: 45, base: 50, bull: 55, unit: '%', core: true },
  { key: 'mkt_capacity', bear: 2826, base: 2826, bull: 2826, unit: '万辆' },
  { key: 'co_share', bear: 13.5, base: 14.5, bull: 15.5, unit: '%', core: true },
  { key: 'asp', bear: 16.5, base: 16.5, bull: 16.5, unit: '万元' },
  { key: 'net_margin', bear: 8, base: 9, bull: 10, unit: '%' },
  { key: 'shares', bear: 29, base: 29, bull: 29, unit: '亿股' },
  { key: 'pe_central', bear: 23, base: 25, bull: 27, unit: 'x' },
]

describe('computeValuationTrace — pe 恒等式阶梯', () => {
  it('全参数 → 6 步 trace + V 三档(参数沿链算出)', () => {
    const r = computeValuationTrace('pe', PE)
    expect(r.ok).toBe(true)
    expect(r.method).toBe('pe')
    expect(r.steps.map((s) => s.out)).toEqual(['行业销量', '公司销量', '营收', '净利', 'EPS', 'V'])
    const base = (out: string) => r.steps.find((s) => s.out === out)!.base
    expect(base('行业销量')).toBe(1413) // 0.5×2826
    expect(base('公司销量')).toBe(205) // ×0.145
    expect(base('EPS')).toBe(10.5)
    expect(r.V?.base).toBe(262) // ×25
    expect(r.V!.bear).toBeLessThan(r.V!.base)
    expect(r.V!.base).toBeLessThan(r.V!.bull)
  })

  it('每步标 inputs(用到的参数 key)→ 重算可定位', () => {
    const r = computeValuationTrace('pe', PE)
    expect(r.steps.find((s) => s.out === '公司销量')!.inputs).toEqual(['co_share'])
    expect(r.steps.find((s) => s.out === 'V')!.inputs).toEqual(['pe_central'])
  })

  it('缺参数 → ok:false + missing 列出(不臆造)', () => {
    const r = computeValuationTrace(
      'pe',
      PE.filter((a) => a.key !== 'shares'),
    )
    expect(r.ok).toBe(false)
    expect(r.V).toBeNull()
    expect(r.missing).toContain('shares')
  })

  it('其余配模式暂占位 → ok:false(UI 回退显存量 V)', () => {
    const r = computeValuationTrace('dcf', [])
    expect(r.ok).toBe(false)
    expect(r.steps).toHaveLength(0)
  })

  it('METHOD_PARAMS: pe 7 参数', () => {
    expect(METHOD_PARAMS.pe).toHaveLength(7)
    expect(METHOD_PARAMS.pe).toContain('co_share')
  })

  it('命门-band:仅命门(core)撑区间;非命门(三档不同)全档取 base', () => {
    const mk = (netMarginCore: boolean): TraceAssumption[] => [
      { key: 'ev_pen', bear: 50, base: 50, bull: 50, unit: '%' },
      { key: 'mkt_capacity', bear: 1000, base: 1000, bull: 1000, unit: '万辆' },
      { key: 'co_share', bear: 10, base: 10, bull: 10, unit: '%' },
      { key: 'asp', bear: 10, base: 10, bull: 10, unit: '万元' },
      // net_margin 是唯一三档不同的参数 → 区间是否打开全看它是不是命门
      { key: 'net_margin', bear: 8, base: 10, bull: 12, unit: '%', core: netMarginCore },
      { key: 'shares', bear: 10, base: 10, bull: 10, unit: '亿股' },
      { key: 'pe_central', bear: 20, base: 20, bull: 20, unit: 'x' },
    ]
    // 非命门:三档不同也全取 base → V 无区间
    const off = computeValuationTrace('pe', mk(false))
    expect(off.V!.bear).toBe(off.V!.base)
    expect(off.V!.bull).toBe(off.V!.base)
    // 命门:撑出区间
    const on = computeValuationTrace('pe', mk(true))
    expect(on.V!.bear).toBeLessThan(on.V!.base)
    expect(on.V!.bull).toBeGreaterThan(on.V!.base)
  })
})

describe('computeValuationTrace — 其余配模式', () => {
  it('pb-roe:合理PB=(ROE−g)/(COE−g) × BVPS', () => {
    const r = computeValuationTrace('pb-roe', [
      { key: 'roe_norm', bear: 13, base: 15, bull: 17, unit: '%' },
      { key: 'bvps', bear: 40, base: 40, bull: 40, unit: '元' },
      { key: 'sustain_growth', bear: 5, base: 5, bull: 5, unit: '%' },
      { key: 'coe', bear: 10, base: 10, bull: 10, unit: '%' },
    ])
    expect(r.ok).toBe(true)
    expect(r.steps.find((s) => s.out === '合理PB')!.base).toBe(2) // (15−5)/(10−5)
    expect(r.V?.base).toBe(80) // 2×40
  })

  it('ddm:戈登增长 DPS(1+g)/(COE−g)', () => {
    const r = computeValuationTrace('ddm', [
      { key: 'dps0', bear: 2, base: 2, bull: 2, unit: '元' },
      { key: 'div_growth', bear: 3, base: 3, bull: 3, unit: '%' },
      { key: 'coe', bear: 8, base: 8, bull: 8, unit: '%' },
    ])
    expect(r.ok).toBe(true)
    expect(r.V?.base).toBe(41.2) // 2×1.03/0.05
  })

  it('nav:Σ分部 − 净负债 ÷ 股本(分部 key 可变)', () => {
    const r = computeValuationTrace('nav', [
      { key: 'seg_battery', bear: 280, base: 300, bull: 320, unit: '亿' },
      { key: 'seg_storage', bear: 180, base: 200, bull: 220, unit: '亿' },
      { key: 'net_debt', bear: 100, base: 100, bull: 100, unit: '亿' },
      { key: 'shares', bear: 20, base: 20, bull: 20, unit: '亿股' },
    ])
    expect(r.ok).toBe(true)
    expect(r.steps.find((s) => s.out === '毛NAV')!.base).toBe(500)
    expect(r.V?.base).toBe(20) // (500−100)/20
  })

  it('dcf:终值法 5 步 + V 三档单调', () => {
    const r = computeValuationTrace('dcf', [
      { key: 'fcf0', bear: 90, base: 100, bull: 110, unit: '亿', core: true },
      { key: 'fcf_growth', bear: 12, base: 15, bull: 18, unit: '%', core: true },
      { key: 'wacc', bear: 10, base: 10, bull: 10, unit: '%' },
      { key: 'term_growth', bear: 3, base: 3, bull: 3, unit: '%' },
      { key: 'horizon', bear: 5, base: 5, bull: 5, unit: '年' },
      { key: 'net_debt', bear: 200, base: 200, bull: 200, unit: '亿' },
      { key: 'shares', bear: 30, base: 30, bull: 30, unit: '亿股' },
    ])
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.out)).toEqual(['预测期PV', '终值PV', '企业价值', '股权价值', 'V'])
    expect(r.V!.base).toBeGreaterThan(0)
    expect(r.V!.bear).toBeLessThan(r.V!.base)
    expect(r.V!.base).toBeLessThan(r.V!.bull)
  })

  it('经济无意义(折现率≤增长率)→ ok:false(不臆造)', () => {
    const dcf = computeValuationTrace('dcf', [
      { key: 'fcf0', bear: 100, base: 100, bull: 100 },
      { key: 'fcf_growth', bear: 5, base: 5, bull: 5, unit: '%' },
      { key: 'wacc', bear: 2, base: 2, bull: 2, unit: '%' }, // wacc < 永续g
      { key: 'term_growth', bear: 3, base: 3, bull: 3, unit: '%' },
      { key: 'horizon', bear: 5, base: 5, bull: 5 },
      { key: 'net_debt', bear: 0, base: 0, bull: 0 },
      { key: 'shares', bear: 10, base: 10, bull: 10 },
    ])
    expect(dcf.ok).toBe(false)
    const ddm = computeValuationTrace('ddm', [
      { key: 'dps0', bear: 2, base: 2, bull: 2 },
      { key: 'div_growth', bear: 9, base: 9, bull: 9, unit: '%' }, // g > COE
      { key: 'coe', bear: 8, base: 8, bull: 8, unit: '%' },
    ])
    expect(ddm.ok).toBe(false)
  })
})
