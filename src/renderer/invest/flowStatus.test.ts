import { describe, it, expect } from 'vitest'
import { flowStatus } from './flowStatus'
import type { CardSummary } from '@shared/types/invest'

const base = (o: Partial<CardSummary>): CardSummary =>
  ({ id: 'c', code: '1', name: 'n', status: 'held', ...o }) as CardSummary

describe('flowStatus', () => {
  it('无逻辑 → 建立', () =>
    expect(flowStatus(base({ claim: undefined, validity: undefined }))).toBe('建立'))
  it('已平仓 → 已平仓', () =>
    expect(flowStatus(base({ status: 'closed', claim: 'x' }))).toBe('已平仓'))
  it('validity=校准 → 校准中', () =>
    expect(flowStatus(base({ claim: 'x', validity: '校准' }))).toBe('校准中'))
  it('validity=证伪 → 校准中', () =>
    expect(flowStatus(base({ claim: 'x', validity: '证伪' }))).toBe('校准中'))
  it('持有态 → 持有', () => expect(flowStatus(base({ claim: 'x', validity: '持有' }))).toBe('持有'))
})
