import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateObject } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  }
})

import { ContextBudgetReflector } from './context-budget'
import type { ReflectContext } from './types'

function preCtx(overrides: Partial<ReflectContext> = {}): ReflectContext {
  const base = {
    phase: 'pre-step' as const,
    stepIndex: 0,
    userIntent: 'task',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    messages: [],
    estimatedTokens: 0,
    contextLimit: 100,
  }
  return { ...base, ...overrides } as ReflectContext
}

describe('ContextBudgetReflector', () => {
  it('非 pre-step 返 null', async () => {
    const r = new ContextBudgetReflector()
    const ctx = { ...preCtx(), phase: 'post-step' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('contextLimit <= 0 返 null', async () => {
    const r = new ContextBudgetReflector()
    expect(await r.reflect(preCtx({ contextLimit: 0 }))).toBeNull()
  })

  it('ratio < warnRatio → null', async () => {
    const r = new ContextBudgetReflector()
    expect(await r.reflect(preCtx({ estimatedTokens: 50, contextLimit: 100 }))).toBeNull()
  })

  it('ratio > 0.98 < 1.0 → hint', async () => {
    const r = new ContextBudgetReflector()
    const out = await r.reflect(preCtx({ estimatedTokens: 99, contextLimit: 100 }))
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/^\[CONTEXT NEARLY FULL\]/)
  })

  it('ratio >= 1.0 + reflectModel undefined → directOutput end + 硬编码兜底', async () => {
    const r = new ContextBudgetReflector()
    const out = await r.reflect(preCtx({ estimatedTokens: 200, contextLimit: 100 }))
    expect(out?.directOutput).toBeDefined()
    expect(out!.directOutput!.endTurn).toBe(true)
    expect(out!.directOutput!.label).toBe('[auto-halt]')
    expect(out!.directOutput!.text).toMatch(/Context window exceeded/)
    expect(out!.directOutput!.exitReason).toBe('context_overflow')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('ratio >= 1.0 + reflectModel → 调 FriendlyHaltAgent', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { friendlyMessage: 'Sorry, ran out of context. Try smaller task.' },
    })
    const r = new ContextBudgetReflector()
    const out = await r.reflect(
      preCtx({
        estimatedTokens: 200,
        contextLimit: 100,
        reflectModel: {} as never,
      }),
    )
    expect(out?.directOutput).toBeDefined()
    expect(out!.directOutput!.text).toContain('Sorry, ran out of context')
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
  })

  it('FriendlyHalt LLM 调用失败 → fallback 硬编码', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('LLM down'))
    const r = new ContextBudgetReflector()
    const out = await r.reflect(
      preCtx({
        estimatedTokens: 200,
        contextLimit: 100,
        reflectModel: {} as never,
      }),
    )
    expect(out?.directOutput!.text).toMatch(/Context window exceeded/)
  })

  it('warnRatio 自定义阈值', async () => {
    const r = new ContextBudgetReflector({ warnRatio: 0.5 })
    const out = await r.reflect(preCtx({ estimatedTokens: 60, contextLimit: 100 }))
    expect(out?.hint).toBeDefined()
  })
})
