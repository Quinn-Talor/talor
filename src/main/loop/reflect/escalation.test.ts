import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateText, mockLedgerRecord } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockLedgerRecord: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  }
})

vi.mock('../../repos/reflection-ledger', () => ({
  reflectionLedger: { record: mockLedgerRecord },
}))

import { EscalationReflector } from './escalation'
import type { ReflectContext } from './types'

function postCtx(stepIndex: number): ReflectContext {
  return {
    phase: 'post-step',
    stepIndex,
    userIntent: 't',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
    facts: {} as never,
    outcome: { stepText: '', toolNames: [] } as never,
    raw: { stepText: '' },
  }
}

beforeEach(() => {
  mockGenerateText.mockReset()
  mockLedgerRecord.mockReset()
})

describe('EscalationReflector', () => {
  it('L1 streak < threshold → null', async () => {
    let hinted = false
    const r = new EscalationReflector({
      threshold: 2,
      wasPreviousStepL1Hinted: () => hinted,
    })
    hinted = true
    expect(await r.reflect(postCtx(0))).toBeNull() // streak=1
  })

  it('L1 streak == threshold → 触发 LLM', async () => {
    const hinted = true
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        progressSoFar: 'x',
        blockerIdentified: 'y',
        strategyShift: 'ask_user',
        nextStepGuidance: 'ask',
        confidence: 0.7,
      }),
    })
    const r = new EscalationReflector({
      threshold: 2,
      wasPreviousStepL1Hinted: () => hinted,
    })
    await r.reflect(postCtx(0)) // streak=1
    const out = await r.reflect(postCtx(1)) // streak=2 触发
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/L1 hints ignored 2×/)
  })

  it('触发后 streak reset', async () => {
    const hinted = true
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        progressSoFar: 'x',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: 'g',
        confidence: 0.7,
      }),
    })
    const r = new EscalationReflector({
      threshold: 2,
      wasPreviousStepL1Hinted: () => hinted,
    })
    await r.reflect(postCtx(0)) // streak=1
    await r.reflect(postCtx(1)) // streak=2 触发, reset
    expect(await r.reflect(postCtx(2))).toBeNull() // streak=1 again, not triggered
  })

  it('上步无 L1 hint → streak reset 为 0', async () => {
    let hinted = true
    const r = new EscalationReflector({
      threshold: 2,
      wasPreviousStepL1Hinted: () => hinted,
    })
    await r.reflect(postCtx(0)) // streak=1
    hinted = false
    await r.reflect(postCtx(1)) // reset
    hinted = true
    expect(await r.reflect(postCtx(2))).toBeNull() // streak=1, not triggered
  })

  it('confidence < 0.5 → null (但 ledger 记)', async () => {
    const hinted = true
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        progressSoFar: 'x',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: 'g',
        confidence: 0.3,
      }),
    })
    const r = new EscalationReflector({
      threshold: 2,
      wasPreviousStepL1Hinted: () => hinted,
    })
    await r.reflect(postCtx(0))
    expect(await r.reflect(postCtx(1))).toBeNull()
    expect(mockLedgerRecord).toHaveBeenCalled()
  })
})
