import { describe, it, expect } from 'vitest'
import { computeTrend } from './trend'

describe('computeTrend', () => {
  it('多窗口 change/方向(序列 老→新)', () => {
    // 序列 [10..16], current=16; 1步前=15(+1), 3步前=13(+3)
    const r = computeTrend([10, 11, 12, 13, 14, 15, 16], [1, 3])
    const w1 = r.windows.find((w) => w.window === 1)!
    expect(w1.change).toBe(1)
    expect(w1.direction).toBe('up')
    const w3 = r.windows.find((w) => w.window === 3)!
    expect(w3.change).toBe(3)
  })

  it('序列不足窗口 → 该窗口 null', () => {
    const r = computeTrend([10, 11], [5])
    expect(r.windows[0].change).toBeNull()
    expect(r.windows[0].direction).toBeNull()
  })

  it('横盘 → flat(噪声阈内)', () => {
    const r = computeTrend([100, 100.2, 100.1, 100.05], [1])
    expect(r.windows[0].direction).toBe('flat')
  })

  it('momentum: 短窗每步涨幅 > 长窗 → accelerating', () => {
    // 末段加速:…,100,101,103,106 → 1步 +2.9%, 3步 +6% (每步2%) → 短>长
    const r = computeTrend([100, 101, 103, 106], [1, 3])
    expect(r.momentum).toBe('accelerating')
  })

  it('momentum: 短窗反向 → reversing', () => {
    // 长期上行但最近一步回落:[100,110,121,118] 1步 -2.5%, 3步 +18%
    const r = computeTrend([100, 110, 121, 118], [1, 3])
    expect(r.momentum).toBe('reversing')
  })

  it('有效窗口 < 2 → momentum null', () => {
    const r = computeTrend([10, 11], [5])
    expect(r.momentum).toBeNull()
  })

  it('可复现: 同输入两次一致', () => {
    const s = [10, 11, 12, 13]
    expect(computeTrend(s, [1, 2])).toEqual(computeTrend(s, [1, 2]))
  })
})
