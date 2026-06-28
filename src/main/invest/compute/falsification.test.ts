import { describe, it, expect } from 'vitest'
import { checkFalsification } from './falsification'
import type { FalsificationRule } from './types'

const rule: FalsificationRule = { metric: 'gross_margin', op: '<', value: 40, persistence: 2 }

describe('checkFalsification', () => {
  it('连续 2 期 < 40 → 触发', () => {
    expect(checkFalsification(rule, [38, 39, 42]).triggered).toBe(true)
  })

  it('仅最近 1 期 < 40(persistence=2)→ 不触发', () => {
    expect(checkFalsification(rule, [38, 41, 42]).triggered).toBe(false)
  })

  it('序列不足 persistence 期 → 不触发', () => {
    expect(checkFalsification(rule, [38]).triggered).toBe(false)
  })

  it("op='>' persistence=1 满足 → 触发", () => {
    const r: FalsificationRule = { metric: 'debt', op: '>', value: 70, persistence: 1 }
    expect(checkFalsification(r, [80]).triggered).toBe(true)
  })

  it('最近期含 NaN → 不触发(不可判)', () => {
    expect(checkFalsification(rule, [NaN, 38, 39]).triggered).toBe(false)
  })
})
