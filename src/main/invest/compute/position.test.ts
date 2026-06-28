import { describe, it, expect } from 'vitest'
import { computePosition } from './position'

describe('computePosition — 仓位的度(§6:边际深度×确信度×风险预算×不确定性)', () => {
  it('高确信 + 深边际 + 低不确定 → 接近风险预算上限', () => {
    const r = computePosition({
      margin_depth: 0.8,
      conviction: 'high',
      risk_budget: 0.1,
      uncertainty: 0.2,
    })
    expect(r.weight).toBeCloseTo(0.1 * 1 * 0.8 * 0.8, 5) // 0.064
  })

  it('确信度缩放:low < mid < high(同其余)', () => {
    const base = { margin_depth: 1, risk_budget: 0.1, uncertainty: 0 } as const
    const lo = computePosition({ ...base, conviction: 'low' }).weight
    const mi = computePosition({ ...base, conviction: 'mid' }).weight
    const hi = computePosition({ ...base, conviction: 'high' }).weight
    expect(lo).toBeLessThan(mi)
    expect(mi).toBeLessThan(hi)
  })

  it('不确定性=1 或 边际深度=0 → 仓位 0', () => {
    expect(
      computePosition({ margin_depth: 1, conviction: 'high', risk_budget: 0.1, uncertainty: 1 })
        .weight,
    ).toBe(0)
    expect(
      computePosition({ margin_depth: 0, conviction: 'high', risk_budget: 0.1, uncertainty: 0 })
        .weight,
    ).toBe(0)
  })

  it('永不超风险预算上限', () => {
    const r = computePosition({
      margin_depth: 5,
      conviction: 'high',
      risk_budget: 0.1,
      uncertainty: -1,
    })
    expect(r.weight).toBeLessThanOrEqual(0.1)
    expect(r.capped).toBe(true)
  })

  it('非有限输入 → 0', () => {
    expect(
      computePosition({ margin_depth: NaN, conviction: 'high', risk_budget: 0.1, uncertainty: 0 })
        .weight,
    ).toBe(0)
  })
})
