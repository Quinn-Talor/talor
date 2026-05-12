import { describe, it, expect } from 'vitest'
import { StreakCounter } from './streak-counter'

describe('StreakCounter', () => {
  it('limit=3: 累计 bump 3 次后返回 true', () => {
    const c = new StreakCounter(3)
    expect(c.bump()).toBe(false)
    expect(c.bump()).toBe(false)
    expect(c.bump()).toBe(true)
  })

  it('reset 后再 bump 重新累计', () => {
    const c = new StreakCounter(2)
    c.bump()
    c.reset()
    expect(c.value).toBe(0)
    expect(c.bump()).toBe(false)
    expect(c.bump()).toBe(true)
  })

  it('加权 bump(2): subagent 失败场景, 一步顶两步', () => {
    const c = new StreakCounter(3)
    expect(c.bump(2)).toBe(false) // count=2
    expect(c.bump(2)).toBe(true) // count=4 >= 3
  })

  it('value 暴露当前计数 (用于 hint 注入判定 streak == limit-1)', () => {
    const c = new StreakCounter(3)
    expect(c.value).toBe(0)
    c.bump()
    expect(c.value).toBe(1)
    c.bump()
    expect(c.value).toBe(2)
  })

  it('limit < 1 抛错 (防误用)', () => {
    expect(() => new StreakCounter(0)).toThrow(/limit must be >= 1/)
    expect(() => new StreakCounter(-1)).toThrow(/limit must be >= 1/)
  })

  it('limit=1: 单次 bump 即触发 (signature-with-error 场景)', () => {
    const c = new StreakCounter(1)
    expect(c.bump()).toBe(true)
  })

  it('达到阈值后继续 bump 仍返回 true (不阻止继续累计)', () => {
    const c = new StreakCounter(2)
    c.bump()
    expect(c.bump()).toBe(true)
    expect(c.bump()).toBe(true) // count=3 仍 >= 2
  })
})
