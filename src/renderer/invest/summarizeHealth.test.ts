import { describe, it, expect } from 'vitest'
import {
  summarizeHealth,
  latestCheckpoint,
  latestValidity,
  healthEmoji,
  gateEmoji,
} from './summarizeHealth'
import type { CardBundle, Checkpoint, GateState } from '@shared/types/invest'

function cp(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    type: '复查',
    at: '2026-04-30',
    against_v: 1,
    validity: '持有',
    checks: [],
    value_now: { V: { bear: 1, base: 2, bull: 3 }, margin_of_safety: { at_buy_point: true } },
    gate: { state: '通行' },
    spawned_v: null,
    signal: { verdict: '等', reason: 'r' },
    ...over,
  }
}
function bundle(checkpoints: Checkpoint[]): CardBundle {
  return {
    id: 'c',
    type: 'stock_card',
    head: {
      id: 'c',
      code: '1',
      name: 'x',
      status: 'held',
      origin_session_id: 's',
      created_at: 't',
      updated_at: 't',
    },
    eligibility: null,
    facts: {},
    thesis: null,
    timeline: checkpoints,
  }
}

describe('summarizeHealth', () => {
  it('无复查 → none/null', () => {
    expect(summarizeHealth(bundle([]))).toEqual({ health: 'none', gate: null })
    expect(summarizeHealth(null)).toEqual({ health: 'none', gate: null })
  })
  // validity 唯一驱动(必填,无回退)
  it('validity 强化/持有 → green', () => {
    expect(summarizeHealth(bundle([cp({ validity: '强化' })])).health).toBe('green')
    expect(summarizeHealth(bundle([cp({ validity: '持有' })])).health).toBe('green')
  })
  it('validity 校准 → yellow', () => {
    expect(summarizeHealth(bundle([cp({ validity: '校准' })])).health).toBe('yellow')
  })
  it('validity 证伪 → red', () => {
    expect(summarizeHealth(bundle([cp({ validity: '证伪' })])).health).toBe('red')
  })
  it('取最新复查 + gate 透传', () => {
    const s = summarizeHealth(
      bundle([cp({ at: '2026-01' }), cp({ at: '2026-04', gate: { state: '节流' } })]),
    )
    expect(s.gate).toBe('节流')
  })
  it('latestCheckpoint / latestValidity: 取末个复查', () => {
    const b = bundle([cp({ at: '2026-01' }), cp({ at: '2026-04', validity: '校准' })])
    expect(latestCheckpoint(b)?.at).toBe('2026-04')
    expect(latestValidity(b)).toBe('校准')
  })
})

describe('emoji', () => {
  it('healthEmoji', () => {
    expect(healthEmoji('green')).toBe('🟢')
    expect(healthEmoji('red')).toBe('🔴')
    expect(healthEmoji('none')).toBe('⚪')
  })
  it('gateEmoji', () => {
    expect(gateEmoji('否决' as GateState)).toBe('🔴')
    expect(gateEmoji('节流' as GateState)).toBe('🟠')
    expect(gateEmoji(null)).toBe('⚪')
  })
})
