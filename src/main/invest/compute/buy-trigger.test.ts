import { describe, it, expect } from 'vitest'
import { buyTriggerPrice } from './buy-trigger'

describe('buyTriggerPrice — 安全边际买点价(§7 锚保守端 × 门槛)', () => {
  it('默认锚 bear:trigger = V_bear × (1 − 门槛)', () => {
    const r = buyTriggerPrice({ bear: 210, base: 265, required: 0.25 })
    expect(r.anchor).toBe('bear')
    expect(r.anchor_value).toBe(210)
    expect(r.trigger).toBeCloseTo(157.5, 5) // 210 × 0.75
  })

  it('锚 base:trigger = V_base × (1 − 门槛)', () => {
    const r = buyTriggerPrice({ bear: 210, base: 280, required: 0.25, anchor: 'base' })
    expect(r.anchor).toBe('base')
    expect(r.anchor_value).toBe(280)
    expect(r.trigger).toBeCloseTo(210, 5) // 280 × 0.75
  })

  it('门槛 0 → trigger = 锚价(无折让)', () => {
    expect(buyTriggerPrice({ bear: 200, base: 300, required: 0 }).trigger).toBe(200)
  })

  it('门槛非法(≥1 或 <0)→ null', () => {
    expect(buyTriggerPrice({ bear: 200, base: 300, required: 1 }).trigger).toBeNull()
    expect(buyTriggerPrice({ bear: 200, base: 300, required: -0.1 }).trigger).toBeNull()
  })

  it('锚价 ≤ 0 或非有限 → null(不臆造)', () => {
    expect(buyTriggerPrice({ bear: 0, base: 300, required: 0.2 }).trigger).toBeNull()
    expect(buyTriggerPrice({ bear: NaN, base: 300, required: 0.2 }).trigger).toBeNull()
  })
})
