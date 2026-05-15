import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockRunForcedSummary } = vi.hoisted(() => ({
  mockRunForcedSummary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../forced-summary', () => ({
  runForcedSummary: mockRunForcedSummary,
  failureStreakSummaryOpts: vi.fn((n: number) => ({ label: `[fs-${n}]` })),
}))

import { FailureStreakReflector } from './failure-streak'
import type { OutcomeFacts } from '../outcome-facts'
import type { ReflectContext } from './types'
import type { ForcedSummaryCtx } from '../forced-summary'

const stubCtx = {} as ForcedSummaryCtx

function facts(over: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: true,
    hasText: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: '',
    ...over,
  }
}

function postCtx(f: OutcomeFacts, stepIndex = 0): ReflectContext {
  return {
    phase: 'post-step',
    stepIndex,
    userIntent: '',
    sessionId: '',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
    facts: f,
    outcome: { stepText: '', toolNames: ['x'] } as never,
    raw: { stepText: '' },
  }
}

describe('FailureStreakReflector', () => {
  it('非 post-step 返 null', async () => {
    const r = new FailureStreakReflector(stubCtx)
    const ctx = { ...postCtx(facts()), phase: 'pre-step' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('allToolsFailed=null (无工具) → 不计数, 返 null', async () => {
    const r = new FailureStreakReflector(stubCtx)
    expect(await r.reflect(postCtx(facts({ allToolsFailed: null })))).toBeNull()
  })

  it('chain == limit-1 (默认 limit=3 → 2) 返 hint', async () => {
    const r = new FailureStreakReflector(stubCtx)
    await r.reflect(postCtx(facts({ allToolsFailed: true }))) // streak=1
    const out = await r.reflect(postCtx(facts({ allToolsFailed: true }))) // streak=2 = limit-1
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/failure-streak warning/)
  })

  it('chain == limit 返 wrapUp', async () => {
    const r = new FailureStreakReflector(stubCtx)
    await r.reflect(postCtx(facts({ allToolsFailed: true })))
    await r.reflect(postCtx(facts({ allToolsFailed: true })))
    const out = await r.reflect(postCtx(facts({ allToolsFailed: true })))
    expect(out?.wrapUp).toBeDefined()
    expect(out!.wrapUp!.markFinal).toBe(true)
  })

  it('SUBAGENT_ 加权 +2 → 第一步即返 hint (streak=2=limit-1)', async () => {
    const r = new FailureStreakReflector(stubCtx, { limit: 3, subagentWeight: 2 })
    const out = await r.reflect(postCtx(facts({ allToolsFailed: true, isSubagentFailure: true })))
    expect(out?.hint).toBeDefined()
  })

  it('SUBAGENT_ 加权 +2 → 第二步即 wrapUp (streak=4>=limit=3)', async () => {
    const r = new FailureStreakReflector(stubCtx, { limit: 3, subagentWeight: 2 })
    await r.reflect(postCtx(facts({ allToolsFailed: true, isSubagentFailure: true })))
    const out = await r.reflect(postCtx(facts({ allToolsFailed: true, isSubagentFailure: true })))
    expect(out?.wrapUp).toBeDefined()
  })

  it('allToolsFailed=false 后 reset counter', async () => {
    const r = new FailureStreakReflector(stubCtx)
    await r.reflect(postCtx(facts({ allToolsFailed: true })))
    await r.reflect(postCtx(facts({ allToolsFailed: true })))
    await r.reflect(postCtx(facts({ allToolsFailed: false }))) // reset
    expect(await r.reflect(postCtx(facts({ allToolsFailed: true })))).toBeNull() // streak=1, 无 hint
  })

  it('wrapUp.runSummary 调 forced-summary', async () => {
    mockRunForcedSummary.mockClear()
    const r = new FailureStreakReflector(stubCtx)
    await r.reflect(postCtx(facts({ allToolsFailed: true })))
    await r.reflect(postCtx(facts({ allToolsFailed: true })))
    const out = await r.reflect(postCtx(facts({ allToolsFailed: true })))
    await out!.wrapUp!.runSummary()
    expect(mockRunForcedSummary).toHaveBeenCalledTimes(1)
  })
})
