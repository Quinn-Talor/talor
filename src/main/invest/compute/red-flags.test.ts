import { describe, it, expect } from 'vitest'
import { computeRedFlags, RED_FLAG_THRESHOLDS } from './red-flags'
import type { NormalizedFinancials } from './types'

function base(): NormalizedFinancials {
  return {
    ocf: 50,
    net_income: 50, // ocf/ni = 1.0 → 不触发
    deducted_ni_history: [10, 8, 6], // 全正
    rev_yoy: 30,
    ar_yoy: 30,
    inv_yoy: 30, // 与营收同步
    goodwill: 10,
    equity: 100, // 0.1
    interest_debt: 30,
    total_assets: 100, // 0.3
    cash: 30,
    audit_nonstandard: false,
  }
}

describe('computeRedFlags', () => {
  it('健康财务: 8 条全部未触发', () => {
    const flags = computeRedFlags(base())
    expect(flags).toHaveLength(8)
    expect(flags.every((f) => f.hit === false)).toBe(true)
  })

  it('ocf_ni_lt_1: 经营现金流/净利润 < 1 触发', () => {
    const f = computeRedFlags({ ...base(), ocf: 20, net_income: 50 })
    expect(f.find((x) => x.flag === 'ocf_ni_lt_1')!.hit).toBe(true)
  })

  it('净利为负: ocf_ni_lt_1 不适用 → null(不误判亏损但现金流好的公司)', () => {
    const f = computeRedFlags({ ...base(), ocf: 50, net_income: -50 })
    expect(f.find((x) => x.flag === 'ocf_ni_lt_1')!.hit).toBeNull()
  })

  it('ar_growth_gt_rev 触发', () => {
    const f = computeRedFlags({
      ...base(),
      ar_yoy: 30 + RED_FLAG_THRESHOLDS.growthGapPp + 1,
      rev_yoy: 30,
    })
    expect(f.find((x) => x.flag === 'ar_growth_gt_rev')!.hit).toBe(true)
  })

  it('inv_growth_gt_rev 触发', () => {
    const f = computeRedFlags({
      ...base(),
      inv_yoy: 30 + RED_FLAG_THRESHOLDS.growthGapPp + 1,
      rev_yoy: 30,
    })
    expect(f.find((x) => x.flag === 'inv_growth_gt_rev')!.hit).toBe(true)
  })

  it('goodwill_high 触发', () => {
    const f = computeRedFlags({ ...base(), goodwill: 40, equity: 100 }) // 0.4 > 0.3
    expect(f.find((x) => x.flag === 'goodwill_high')!.hit).toBe(true)
  })

  it('debt_high 触发', () => {
    const f = computeRedFlags({ ...base(), interest_debt: 70, total_assets: 100 }) // 0.7 > 0.6
    expect(f.find((x) => x.flag === 'debt_high')!.hit).toBe(true)
  })

  it('deducted_neg: 扣非连续为负 触发', () => {
    const f = computeRedFlags({ ...base(), deducted_ni_history: [-1, -2, -3] })
    expect(f.find((x) => x.flag === 'deducted_neg')!.hit).toBe(true)
  })

  it('cash_debt_double_high 触发', () => {
    const f = computeRedFlags({ ...base(), cash: 60, interest_debt: 60, total_assets: 100 })
    expect(f.find((x) => x.flag === 'cash_debt_double_high')!.hit).toBe(true)
  })

  it('audit_nonstandard 一票否决', () => {
    const f = computeRedFlags({ ...base(), audit_nonstandard: true })
    expect(f.find((x) => x.flag === 'audit_nonstandard')!.hit).toBe(true)
  })

  it('数据缺失(NaN)→ hit=null 不误判', () => {
    const f = computeRedFlags({ ...base(), goodwill: NaN })
    expect(f.find((x) => x.flag === 'goodwill_high')!.hit).toBeNull()
  })

  it('可复现: 同输入两次调用结果一致', () => {
    const a = computeRedFlags(base())
    const b = computeRedFlags(base())
    expect(a).toEqual(b)
  })
})
