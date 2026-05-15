import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ToolOnlyLoopReflector } from './tool-only-loop'
import type { OutcomeFacts } from '../outcome-facts'
import type { ReflectContext } from './types'

function facts(over: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: false,
    hasText: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: '',
    ...over,
  }
}

function postCtx(f: OutcomeFacts): ReflectContext {
  return {
    phase: 'post-step',
    stepIndex: 0,
    userIntent: '',
    sessionId: '',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
    facts: f,
    outcome: { stepText: '', toolNames: [] } as never,
    raw: { stepText: '' },
  }
}

describe('ToolOnlyLoopReflector', () => {
  it('非 post-step 返 null', async () => {
    const r = new ToolOnlyLoopReflector({ hintAt: 3 })
    const ctx = { ...postCtx(facts()), phase: 'turn-end' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('counter < hintAt: 返 null', async () => {
    const r = new ToolOnlyLoopReflector({ hintAt: 3 })
    await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    expect(await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))).toBeNull()
  })

  it('counter >= hintAt: 返 hint', async () => {
    const r = new ToolOnlyLoopReflector({ hintAt: 3 })
    await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    const out = await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/progress-report needed/)
  })

  it('hasText 后 reset', async () => {
    const r = new ToolOnlyLoopReflector({ hintAt: 3 })
    await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    await r.reflect(postCtx(facts({ hasToolCall: true, hasText: true }))) // reset
    expect(await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))).toBeNull()
  })

  it('永远不返 wrapUp', async () => {
    const r = new ToolOnlyLoopReflector({ hintAt: 1 })
    const out = await r.reflect(postCtx(facts({ hasToolCall: true, hasText: false })))
    expect(out?.wrapUp).toBeUndefined()
  })
})
