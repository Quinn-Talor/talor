import { describe, it, expect } from 'vitest'
import { computeDecision } from './decision'

describe('computeDecision', () => {
  it('好质地+便宜 → 好公司好价格/买', () => {
    const r = computeDecision({ quality: 'good', valuation_state: 'cheap', max_loss_pct: 20 })
    expect(r.matrix_cell).toBe('好公司好价格')
    expect(r.action).toBe('买')
  })

  it('好质地+贵 → 好公司贵/等', () => {
    const r = computeDecision({ quality: 'good', valuation_state: 'expensive', max_loss_pct: 20 })
    expect(r.matrix_cell).toBe('好公司贵')
    expect(r.action).toBe('等')
    expect(r.suggested_position_pct).toBe(0) // 等也不建仓
  })

  it('差质地+便宜 → 价值陷阱/弃(便宜不是买的理由)', () => {
    const r = computeDecision({ quality: 'poor', valuation_state: 'cheap', max_loss_pct: 20 })
    expect(r.matrix_cell).toBe('价值陷阱')
    expect(r.action).toBe('弃')
    expect(r.suggested_position_pct).toBe(0)
  })

  it('差质地+贵 → 远离/弃', () => {
    const r = computeDecision({ quality: 'poor', valuation_state: 'expensive', max_loss_pct: 20 })
    expect(r.matrix_cell).toBe('远离')
    expect(r.action).toBe('弃')
  })

  it('仓位反推: risk 2% / max_loss 20% → 10% 仓位(命中上限)', () => {
    const r = computeDecision({ quality: 'good', valuation_state: 'cheap', max_loss_pct: 20 })
    expect(r.suggested_position_pct).toBe(10) // raw=10,cap=10
  })

  it('仓位反推: 亏损越大仓位越小,且受 cap 约束', () => {
    const r = computeDecision({
      quality: 'good',
      valuation_state: 'cheap',
      max_loss_pct: 40,
      risk_per_trade_pct: 2,
      position_cap_pct: 10,
    })
    expect(r.suggested_position_pct).toBe(5) // 2/40×100 = 5
  })

  it('不触发: max_loss≤0 → 仓位 null(止损位无意义)', () => {
    const r = computeDecision({ quality: 'good', valuation_state: 'cheap', max_loss_pct: 0 })
    expect(r.suggested_position_pct).toBeNull()
  })

  it('可复现: 同输入两次一致', () => {
    const inp = { quality: 'good' as const, valuation_state: 'cheap' as const, max_loss_pct: 20 }
    expect(computeDecision(inp)).toEqual(computeDecision(inp))
  })
})
