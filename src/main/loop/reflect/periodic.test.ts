import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateObject, mockLedgerRecord } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
  mockLedgerRecord: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  }
})

vi.mock('../../repos/reflection-ledger', () => ({
  reflectionLedger: { record: mockLedgerRecord },
}))

import { PeriodicReflector } from './periodic'
import type { ReflectContext } from './types'

function postCtx(stepIndex: number): ReflectContext {
  return {
    phase: 'post-step',
    stepIndex,
    userIntent: 'task',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
    facts: {} as never,
    outcome: { stepText: 'x', toolNames: [] } as never,
    raw: { stepText: 'x' },
  }
}

beforeEach(() => {
  mockGenerateObject.mockReset()
  mockLedgerRecord.mockReset()
})

describe('PeriodicReflector', () => {
  it('非 post-step 返 null', async () => {
    const r = new PeriodicReflector({ every: 5 })
    const ctx = { ...postCtx(4), phase: 'turn-end' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('stepIndex < every-1 → null', async () => {
    const r = new PeriodicReflector({ every: 5 })
    expect(await r.reflect(postCtx(3))).toBeNull()
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('stepIndex+1 % every == 0 触发, confidence ≥ 0.5 返 hint', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        progressSoFar: '已完成 X',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: '继续 Y',
        confidence: 0.8,
      },
    })
    const r = new PeriodicReflector({ every: 5 })
    const out = await r.reflect(postCtx(4)) // stepIndex 4, (4+1)%5==0
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/^\[reflection\]/)
    expect(mockLedgerRecord).toHaveBeenCalled()
  })

  it('confidence < 0.5 → 丢弃 hint 但记 ledger', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        progressSoFar: 'x',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: 'y',
        confidence: 0.3,
      },
    })
    const r = new PeriodicReflector({ every: 5 })
    expect(await r.reflect(postCtx(4))).toBeNull()
    expect(mockLedgerRecord).toHaveBeenCalledTimes(1)
  })

  it('blockerIdentified 非空时 hint 含 Blocker:', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        progressSoFar: '已查 3 张表',
        blockerIdentified: '第 4 张表 schema 不全',
        strategyShift: 'switch_tool',
        nextStepGuidance: '试 DESCRIBE',
        confidence: 0.7,
      },
    })
    const r = new PeriodicReflector({ every: 5 })
    const out = await r.reflect(postCtx(4))
    expect(out!.hint!).toContain('Blocker: 第 4 张表 schema 不全')
  })

  it('LLM 失败 → null', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('LLM down'))
    const r = new PeriodicReflector({ every: 5 })
    expect(await r.reflect(postCtx(4))).toBeNull()
  })

  it('every=0 关闭周期反思', async () => {
    const r = new PeriodicReflector({ every: 0 })
    expect(await r.reflect(postCtx(4))).toBeNull()
    expect(await r.reflect(postCtx(9))).toBeNull()
  })
})
