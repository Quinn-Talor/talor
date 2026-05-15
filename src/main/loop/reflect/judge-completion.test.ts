import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  }
})

import { JudgeCompletionReflector } from './judge-completion'
import type { ReflectContext } from './types'

function turnEndCtx(overrides: Partial<ReflectContext> = {}): ReflectContext {
  const base = {
    phase: 'turn-end' as const,
    stepIndex: 0,
    userIntent: 'do X then Y',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
    facts: {} as never,
    outcome: { stepText: 'done', toolNames: [] } as never,
    raw: { stepText: 'done' },
    policyDecision: 'final' as const,
  }
  return { ...base, ...overrides } as ReflectContext
}

describe('JudgeCompletionReflector', () => {
  it('非 turn-end 返 null', async () => {
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = { ...turnEndCtx(), phase: 'post-step' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('outcome.toolNames 非空 → null (final 必无 tool)', async () => {
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = turnEndCtx({ outcome: { stepText: 'x', toolNames: ['bash'] } as never })
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('outcome.stepText 空 → null', async () => {
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = turnEndCtx({ outcome: { stepText: '', toolNames: [] } as never })
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('complete=true → null (放行 final)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })

  it('complete=false, confidence>=0.5 → directOutput(endTurn=false)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        complete: false,
        pendingItems: ['Y not done'],
        reason: 'Y missing',
        confidence: 0.8,
      }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const out = await r.reflect(turnEndCtx())
    expect(out?.directOutput).toBeDefined()
    expect(out!.directOutput!.endTurn).toBe(false)
    expect(out!.directOutput!.label).toBe('[reflection-judge]')
    expect(out!.directOutput!.text).toContain('Y not done')
  })

  it('confidence < 0.5 → 丢弃 (放行 final)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ complete: false, pendingItems: ['x'], reason: 'r', confidence: 0.3 }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })

  it('generateObject 抛错 → null (失败静默, 不阻塞)', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('LLM down'))
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })
})
