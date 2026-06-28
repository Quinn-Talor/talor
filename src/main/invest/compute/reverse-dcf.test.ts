import { describe, it, expect } from 'vitest'
import { reverseDcf } from './reverse-dcf'

describe('reverseDcf', () => {
  it('闭式自洽: 用 g=0.2 构造公平价 → 反推回 0.2', () => {
    const eps = 2,
      g = 0.2,
      N = 3,
      exitPe = 15,
      disc = 0.1
    const price = (eps * Math.pow(1 + g, N) * exitPe) / Math.pow(1 + disc, N)
    const r = reverseDcf({ price, eps, exitPe, horizonYears: N, discount: disc })
    expect(r.impliedGrowth).toBeCloseTo(0.2, 4)
    expect(r.reasonable).toBe(true)
  })

  it('极高价 → 隐含增速离谱 reasonable=false', () => {
    const r = reverseDcf({ price: 500, eps: 2, exitPe: 15, horizonYears: 3, discount: 0.1 })
    expect(r.impliedGrowth!).toBeGreaterThan(0.3)
    expect(r.reasonable).toBe(false)
  })

  it('eps ≤ 0 → 不可解 null', () => {
    expect(
      reverseDcf({ price: 40, eps: 0, exitPe: 15, horizonYears: 3, discount: 0.1 }).impliedGrowth,
    ).toBeNull()
  })

  it('可复现: 同输入两次一致', () => {
    const inp = { price: 40, eps: 2, exitPe: 15, horizonYears: 3, discount: 0.1 }
    expect(reverseDcf(inp)).toEqual(reverseDcf(inp))
  })
})
