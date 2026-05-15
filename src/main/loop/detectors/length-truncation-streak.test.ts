// src/main/loop/detectors/length-truncation-streak.test.ts
//
// 防 finishReason='length' 死循环 — 混合体 (Detector + Reflector) 测试。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LengthTruncationStreak } from './length-truncation-streak'
import type { FinishReason } from 'ai'
import type { OutcomeFacts } from '../outcome-facts'
import type { ReflectContext } from '../reflect/types'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const fact = (over: Partial<OutcomeFacts> = {}): OutcomeFacts => ({
  hasToolCall: false,
  hasText: true,
  allToolsFailed: null,
  isSubagentFailure: false,
  signature: '',
  ...over,
})

const rawWith = (finishReason?: FinishReason) => ({ stepText: 'x', finishReason })

function postCtx(): ReflectContext {
  return {
    phase: 'post-step',
    stepIndex: 0,
    userIntent: '',
    sessionId: '',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    facts: fact(),
    outcome: { stepText: '', toolNames: [] } as never,
    raw: { stepText: '' },
  }
}

describe('LengthTruncationStreak — Detector 角色', () => {
  let d: LengthTruncationStreak
  beforeEach(() => {
    d = new LengthTruncationStreak()
  })

  it('单次 length → 不触发', () => {
    expect(d.observe(fact(), 0, rawWith('length')).triggered).toBe(false)
  })

  it('连续 3 次 length → triggered + continuation_chain', () => {
    d.observe(fact(), 0, rawWith('length'))
    d.observe(fact(), 1, rawWith('length'))
    const v = d.observe(fact(), 2, rawWith('length'))
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('continuation_chain')
  })

  it('finishReason="stop" 后 reset', () => {
    d.observe(fact(), 0, rawWith('length'))
    d.observe(fact(), 1, rawWith('length'))
    d.observe(fact(), 2, rawWith('stop'))
    expect(d.observe(fact(), 3, rawWith('length')).triggered).toBe(false)
  })

  it('triggered 后 chain reset (防同 session 错误复用)', () => {
    d.observe(fact(), 0, rawWith('length'))
    d.observe(fact(), 1, rawWith('length'))
    d.observe(fact(), 2, rawWith('length'))
    expect(d.observe(fact(), 3, rawWith('length')).triggered).toBe(false)
  })

  it('自定义 limit=2 → 第 2 次即 triggered', () => {
    const d2 = new LengthTruncationStreak({ limit: 2 })
    d2.observe(fact(), 0, rawWith('length'))
    expect(d2.observe(fact(), 1, rawWith('length')).triggered).toBe(true)
  })

  it('无 finishReason → 静默', () => {
    expect(d.observe(fact(), 0, { stepText: 'x' }).triggered).toBe(false)
    expect(d.observe(fact()).triggered).toBe(false)
  })
})

describe('LengthTruncationStreak — Reflector 角色', () => {
  it('chain=limit-1 时 reflect 返 hint', async () => {
    const d = new LengthTruncationStreak()
    d.observe(fact(), 0, rawWith('length'))
    d.observe(fact(), 1, rawWith('length'))
    const out = await d.reflect(postCtx())
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/truncated/)
    expect(out!.hint!).toMatch(/WRITE TOOL/)
  })

  it('chain < limit-1 时 reflect 返 null', async () => {
    const d = new LengthTruncationStreak()
    d.observe(fact(), 0, rawWith('length'))
    expect(await d.reflect(postCtx())).toBeNull()
  })

  it('hint 只输出一次, 再调返 null', async () => {
    const d = new LengthTruncationStreak()
    d.observe(fact(), 0, rawWith('length'))
    d.observe(fact(), 1, rawWith('length'))
    await d.reflect(postCtx())
    expect(await d.reflect(postCtx())).toBeNull()
  })

  it('非 post-step phase 返 null', async () => {
    const d = new LengthTruncationStreak()
    d.observe(fact(), 0, rawWith('length'))
    d.observe(fact(), 1, rawWith('length'))
    const ctx = { ...postCtx(), phase: 'pre-step' as const } as never
    expect(await d.reflect(ctx)).toBeNull()
  })
})
