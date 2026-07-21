// factFreshness:as_of 相对今天、按 cadence 判过时(now 注入,可测)
import { describe, it, expect } from 'vitest'
import { factFreshness } from './summarizeHealth'
import type { Facts } from '@shared/types/invest'

const NOW = new Date('2026-07-01')

describe('factFreshness(相对今天 · 按 cadence)', () => {
  it('全卡 2022 + now 2026-07 → 相对今天、stale=true', () => {
    const facts: Facts = {
      co_share: {
        level: 'company',
        label: '份额',
        unit: '%',
        series: [{ value: '16%', as_of: '2022-03', source: '乘联会' }],
      },
    }
    const f = factFreshness(facts, NOW)
    expect(f.co_share.stale).toBe(true)
    expect(f.co_share.ageMonths).toBeGreaterThan(40) // 相对今天,非相对卡内(旧实现会得 0)
  })
  it('irregular → 不 stale(不设绝对新鲜闸)', () => {
    const facts: Facts = {
      policy: {
        level: 'macro',
        label: '政策',
        cadence: 'irregular',
        series: [{ value: '宽松', as_of: '2020-01', source: '国务院' }],
      },
    }
    expect(factFreshness(facts, NOW).policy.stale).toBe(false)
  })
  it('近期季度(4 月龄 ≤ 5)→ 不 stale', () => {
    const facts: Facts = {
      rev: {
        level: 'company',
        label: '营收',
        unit: '亿',
        series: [{ value: '1', as_of: '2026-03', source: '年报' }],
      },
    }
    expect(factFreshness(facts, NOW).rev.stale).toBe(false)
  })
  it('月度指标(4 月龄 > 2)→ stale', () => {
    const facts: Facts = {
      pmi: {
        level: 'macro',
        label: 'PMI',
        series: [{ value: '50', as_of: '2026-03', source: '统计局' }],
      },
    }
    expect(factFreshness(facts, NOW).pmi.stale).toBe(true)
  })
})
