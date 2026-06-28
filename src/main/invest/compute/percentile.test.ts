import { describe, it, expect } from 'vitest'
import { computePercentile } from './percentile'

describe('computePercentile', () => {
  it('当前=历史中位: ≤口径 = 0.6(含自身),非 0.5', () => {
    expect(computePercentile([10, 20, 30, 40, 50], 30)).toBeCloseTo(0.6, 5)
  })

  it('当前值最高: 分位 1', () => {
    expect(computePercentile([10, 20, 30], 35)).toBe(1)
  })

  it('当前值最低: 分位 0', () => {
    expect(computePercentile([10, 20, 30], 5)).toBe(0)
  })

  it('空序列 → null', () => {
    expect(computePercentile([], 30)).toBeNull()
  })

  it('当前 NaN → null', () => {
    expect(computePercentile([10, 20, 30], NaN)).toBeNull()
  })

  it('忽略历史中的 NaN', () => {
    expect(computePercentile([10, NaN, 30], 30)).toBeCloseTo(1, 5) // 有效[10,30],30≥都 → 1
  })
})
