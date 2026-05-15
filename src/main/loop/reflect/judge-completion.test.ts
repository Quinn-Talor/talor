import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// 默认 stepText 含未来时承诺词 — code-filter 命中, 进入 LLM judge 路径
const RISKY_FINAL = "Done with part 1. I'll continue with part 2 next."

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
    outcome: { stepText: RISKY_FINAL, toolNames: [] } as never,
    raw: { stepText: RISKY_FINAL },
    policyDecision: 'final' as const,
  }
  return { ...base, ...overrides } as ReflectContext
}

describe('JudgeCompletionReflector', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

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

  // ── code-filter: 没有未来时承诺词 → 跳过 LLM 调用 ──
  describe('code-filter (避免对 healthy final 白调 LLM)', () => {
    it('final 不含承诺词 → 直接 null, 零 LLM 调用', async () => {
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        outcome: {
          stepText: 'The query returned 3 rows: alice, bob, charlie.',
          toolNames: [],
        } as never,
      })
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it("final 含 'I will' → 触发 LLM judge", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          complete: false,
          pendingItems: ['p'],
          reason: 'r',
          confidence: 0.7,
        }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        outcome: { stepText: 'I will continue with the next step.', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('final 含中文承诺词 "接下来" → 触发 LLM judge', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        outcome: { stepText: '已查询完毕, 接下来我会整理数据。', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it("final 含 'Let me' → 触发 LLM judge", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        outcome: {
          stepText: 'Let me check the database schema for you.',
          toolNames: [],
        } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })
  })
})
