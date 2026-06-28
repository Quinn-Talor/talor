import { describe, it, expect } from 'vitest'
import { crossCheck } from './cross-check'

describe('crossCheck', () => {
  it('多源一致(偏差 < 阈)→ consistent, 取中位数', () => {
    const r = crossCheck(
      [
        { value: 100, source: 'a' },
        { value: 101, source: 'b' },
      ],
      0.05,
    )
    expect(r.consistent).toBe(true)
    expect(r.value).toBe(100.5)
  })

  it('多源分歧(偏差 > 阈)→ 存疑', () => {
    const r = crossCheck(
      [
        { value: 100, source: 'a' },
        { value: 130, source: 'b' },
      ],
      0.05,
    )
    expect(r.consistent).toBe(false)
    expect(r.note).toContain('存疑')
  })

  it('单源 → consistent=null', () => {
    const r = crossCheck([{ value: 100, source: 'a' }], 0.05)
    expect(r.consistent).toBeNull()
    expect(r.value).toBe(100)
  })

  it('空输入 → value null', () => {
    expect(crossCheck([], 0.05).value).toBeNull()
  })
})
