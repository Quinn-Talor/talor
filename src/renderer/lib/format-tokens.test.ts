import { describe, it, expect } from 'vitest'
import { formatTokens } from './format-tokens'

describe('formatTokens (GitHub 风格)', () => {
  it('< 1000 原样整数', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(96)).toBe('96')
    expect(formatTokens(942)).toBe('942')
    expect(formatTokens(999)).toBe('999')
  })

  it('1k–9.9k 给 1 位小数,去掉 .0', () => {
    expect(formatTokens(1000)).toBe('1k')
    expect(formatTokens(1536)).toBe('1.5k')
    expect(formatTokens(1936)).toBe('1.9k')
    expect(formatTokens(2502)).toBe('2.5k')
    expect(formatTokens(9400)).toBe('9.4k')
  })

  it('≥10k 取整 k', () => {
    expect(formatTokens(10000)).toBe('10k')
    expect(formatTokens(24980)).toBe('25k')
    expect(formatTokens(105984)).toBe('106k')
    expect(formatTokens(130964)).toBe('131k')
  })

  it('≥1M 给 1 位小数,去掉 .0', () => {
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_300_000)).toBe('1.3M')
    expect(formatTokens(12_000_000)).toBe('12M')
  })

  it('边界:9.96k 过渡到 10k', () => {
    expect(formatTokens(9960)).toBe('10k')
  })

  it('边界:999,500 四舍五入升到 1M(不出现 1000k)', () => {
    expect(formatTokens(999_500)).toBe('1M')
  })

  it('非法/负值兜底为 0', () => {
    expect(formatTokens(NaN)).toBe('0')
    expect(formatTokens(-5)).toBe('0')
    expect(formatTokens(Infinity)).toBe('0')
  })
})
