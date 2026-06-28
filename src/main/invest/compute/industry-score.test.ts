import { describe, it, expect } from 'vitest'
import { computeIndustryScore } from './industry-score'

describe('computeIndustryScore', () => {
  it('需求:低渗透+高增速=good;增速转负=bad', () => {
    expect(
      computeIndustryScore({ demand: { penetration_pct: 12, growth_pct: 25 } }).dimensions[0]
        .signal,
    ).toBe('good')
    expect(computeIndustryScore({ demand: { growth_pct: -5 } }).dimensions[0].signal).toBe('bad')
  })

  it('供给:产能出清/克制=good;过剩=bad', () => {
    expect(computeIndustryScore({ supply: { capex_phase: 'clearing' } }).dimensions[0].signal).toBe(
      'good',
    )
    expect(
      computeIndustryScore({ supply: { capex_phase: 'overcapacity' } }).dimensions[0].signal,
    ).toBe('bad')
    expect(computeIndustryScore({ supply: { capacity_util_pct: 60 } }).dimensions[0].signal).toBe(
      'bad',
    )
  })

  it('价格库存:提价+主动补库=good;价格战/被动累库=bad', () => {
    expect(
      computeIndustryScore({ price_inventory: { price_trend: 'up', inventory: 'active_restock' } })
        .dimensions[0].signal,
    ).toBe('good')
    expect(
      computeIndustryScore({ price_inventory: { price_trend: 'down' } }).dimensions[0].signal,
    ).toBe('bad')
    expect(
      computeIndustryScore({ price_inventory: { inventory: 'passive_buildup' } }).dimensions[0]
        .signal,
    ).toBe('bad')
  })

  it('格局:向头部集中=good;分散/内卷=bad', () => {
    expect(
      computeIndustryScore({ structure: { concentration_trend: 'rising' } }).dimensions[0].signal,
    ).toBe('good')
    expect(
      computeIndustryScore({ structure: { concentration_trend: 'fragmenting' } }).dimensions[0]
        .signal,
    ).toBe('bad')
  })

  it('政策:扶持=good;集采打压=bad', () => {
    expect(computeIndustryScore({ policy: { stance: 'support' } }).dimensions[0].signal).toBe(
      'good',
    )
    expect(computeIndustryScore({ policy: { stance: 'suppress' } }).dimensions[0].signal).toBe(
      'bad',
    )
  })

  it('估值:低分位=good;高分位=bad(透支)', () => {
    expect(computeIndustryScore({ valuation: { pe_pb_percentile: 15 } }).dimensions[0].signal).toBe(
      'good',
    )
    expect(computeIndustryScore({ valuation: { pe_pb_percentile: 85 } }).dimensions[0].signal).toBe(
      'bad',
    )
  })

  it('汇总:good>bad → up;bad>good → down;持平 → flat;无输入 → null', () => {
    const r = computeIndustryScore({
      demand: { penetration_pct: 12, growth_pct: 25 }, // good
      supply: { capex_phase: 'restrained' }, // good
      price_inventory: { price_trend: 'down' }, // bad
      valuation: { pe_pb_percentile: 85 }, // bad
      structure: { concentration_trend: 'rising' }, // good
    })
    expect(r.good).toBe(3)
    expect(r.bad).toBe(2)
    expect(r.overall).toBe('up')
    expect(computeIndustryScore({ valuation: { pe_pb_percentile: 85 } }).overall).toBe('down')
    expect(computeIndustryScore({}).overall).toBeNull()
  })

  it('只评提供了输入的维度', () => {
    const r = computeIndustryScore({ policy: { stance: 'support' } })
    expect(r.dimensions).toHaveLength(1)
    expect(r.dimensions[0].dim).toBe('政策')
  })

  it('可复现', () => {
    const inp = { demand: { penetration_pct: 12, growth_pct: 25 } }
    expect(computeIndustryScore(inp)).toEqual(computeIndustryScore(inp))
  })
})
