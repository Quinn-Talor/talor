import { describe, it, expect } from 'vitest'
import { computeValuation } from './valuation'

describe('computeValuation', () => {
  it('pe 三情景: 每情景 eps×pe + 概率加权期望', () => {
    const r = computeValuation({
      method: 'pe',
      scenarios: [
        { label: '悲观', prob: 0.3, eps: 11.7, pe: 18 },
        { label: '中性', prob: 0.5, eps: 12.8, pe: 22 },
        { label: '乐观', prob: 0.2, eps: 13.6, pe: 26 },
      ],
    })
    expect(r.scenarios.map((s) => s.value)).toEqual([11.7 * 18, 12.8 * 22, 13.6 * 26])
    const exp = 0.3 * 11.7 * 18 + 0.5 * 12.8 * 22 + 0.2 * 13.6 * 26
    expect(r.expected).toBeCloseTo(exp, 6)
  })

  it('prob 未严格 sum=1 时按总和归一', () => {
    const r = computeValuation({
      method: 'pe',
      scenarios: [
        { label: 'a', prob: 1, eps: 10, pe: 20 }, // 200
        { label: 'b', prob: 1, eps: 10, pe: 30 }, // 300
      ],
    })
    expect(r.expected).toBeCloseTo(250, 6) // (200+300)/2,而非 200+300
  })

  it('dcf 终值法: 与闭式公式一致', () => {
    const eps = 2,
      g = 0.2,
      N = 3,
      exitPe = 15,
      disc = 0.1
    const r = computeValuation({
      method: 'dcf',
      scenarios: [{ label: '中性', prob: 1, eps, g, exitPe, horizonYears: N, discount: disc }],
    })
    const want = (eps * Math.pow(1 + g, N) * exitPe) / Math.pow(1 + disc, N)
    expect(r.scenarios[0].value).toBeCloseTo(want, 6)
    expect(r.expected).toBeCloseTo(want, 6)
  })

  it('不触发: 任一情景缺输入 → 该情景 value=null 且 expected=null', () => {
    const r = computeValuation({
      method: 'pe',
      scenarios: [
        { label: '中性', prob: 0.5, eps: 12.8, pe: 22 },
        { label: '乐观', prob: 0.5, eps: 13.6 }, // 缺 pe
      ],
    })
    expect(r.scenarios[1].value).toBeNull()
    expect(r.expected).toBeNull()
  })

  it('不触发: 空情景 → expected=null', () => {
    expect(computeValuation({ method: 'pe', scenarios: [] }).expected).toBeNull()
  })

  it('dcf 不可解(eps≤0)→ value=null', () => {
    const r = computeValuation({
      method: 'dcf',
      scenarios: [
        { label: 'x', prob: 1, eps: 0, g: 0.2, exitPe: 15, horizonYears: 3, discount: 0.1 },
      ],
    })
    expect(r.scenarios[0].value).toBeNull()
  })

  // —— 配业务的新方法:pb-roe / ddm / nav ——
  it('pb-roe: 给定目标 PB → bvps×pb', () => {
    const r = computeValuation({
      method: 'pb-roe',
      scenarios: [{ label: '中性', prob: 1, bvps: 10, pb: 1.5 }],
    })
    expect(r.scenarios[0].value).toBeCloseTo(15, 6)
  })

  it('pb-roe: 无目标 PB 时用 ROE 折算合理 PB=(ROE−g)/(r−g)', () => {
    const bvps = 10,
      roe = 0.18,
      g = 0.05,
      r = 0.1
    const v = computeValuation({
      method: 'pb-roe',
      scenarios: [{ label: '中性', prob: 1, bvps, roe, g, discount: r }],
    })
    const justifiedPb = (roe - g) / (r - g)
    expect(v.scenarios[0].value).toBeCloseTo(bvps * justifiedPb, 6)
  })

  it('pb-roe 不可解(r≤g)→ value=null', () => {
    const r = computeValuation({
      method: 'pb-roe',
      scenarios: [{ label: 'x', prob: 1, bvps: 10, roe: 0.18, g: 0.12, discount: 0.1 }],
    })
    expect(r.scenarios[0].value).toBeNull()
  })

  it('ddm 戈登增长: D₁/(r−g)', () => {
    const dps = 2,
      g = 0.03,
      r = 0.08
    const v = computeValuation({
      method: 'ddm',
      scenarios: [{ label: '中性', prob: 1, dps, g, discount: r }],
    })
    expect(v.scenarios[0].value).toBeCloseTo((dps * (1 + g)) / (r - g), 6)
  })

  it('ddm 不可解(r≤g)→ value=null', () => {
    const r = computeValuation({
      method: 'ddm',
      scenarios: [{ label: 'x', prob: 1, dps: 2, g: 0.1, discount: 0.08 }],
    })
    expect(r.scenarios[0].value).toBeNull()
  })

  it('nav: navps×(1+premium),premium 折价为负', () => {
    const r = computeValuation({
      method: 'nav',
      scenarios: [
        { label: '平价', prob: 0.5, navps: 20 },
        { label: '八折', prob: 0.5, navps: 20, premium: -0.2 },
      ],
    })
    expect(r.scenarios[0].value).toBeCloseTo(20, 6)
    expect(r.scenarios[1].value).toBeCloseTo(16, 6)
  })

  it('可复现: 同输入两次一致', () => {
    const inp = {
      method: 'pe' as const,
      scenarios: [{ label: '中性', prob: 1, eps: 12.8, pe: 22 }],
    }
    expect(computeValuation(inp)).toEqual(computeValuation(inp))
  })
})
