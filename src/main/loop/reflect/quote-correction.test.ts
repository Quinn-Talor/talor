import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const {
  mockGenerateText,
  mockListBySession,
  mockLedgerRecord,
  mockVerifyQuoted,
  mockVerifyEntity,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockListBySession: vi.fn(() => [] as unknown[]),
  mockLedgerRecord: vi.fn(),
  mockVerifyQuoted: vi.fn(),
  mockVerifyEntity: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  }
})

vi.mock('../../repos/session-repo', () => ({
  messageRepo: { listBySession: mockListBySession },
}))

vi.mock('../../repos/reflection-ledger', () => ({
  reflectionLedger: { record: mockLedgerRecord },
}))

vi.mock('../quote-verifier', () => ({
  verifyQuotedFacts: mockVerifyQuoted,
  verifyEntityGrounding: mockVerifyEntity,
}))

import { QuoteCorrectionReflector } from './quote-correction'
import type { ReflectContext } from './types'

function turnEndCtx(stepText = 'final answer'): ReflectContext {
  return {
    phase: 'turn-end',
    stepIndex: 5,
    userIntent: 't',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
    facts: {} as never,
    outcome: { stepText, toolNames: [] } as never,
    raw: { stepText },
    policyDecision: 'final',
  }
}

beforeEach(() => {
  mockGenerateText.mockReset()
  mockListBySession.mockReset()
  mockLedgerRecord.mockReset()
  mockVerifyQuoted.mockReset()
  mockVerifyEntity.mockReset()
  // 默认: session 含 1 条 tool message
  mockListBySession.mockReturnValue([
    {
      role: 'tool',
      content: JSON.stringify([{ type: 'tool_result', output: 'real data here' }]),
    },
  ])
  mockVerifyQuoted.mockReturnValue({ cleaned: 'final answer', unverifiedCount: 0 })
  mockVerifyEntity.mockReturnValue({ cleaned: 'final answer', ungroundedCount: 0 })
})

describe('QuoteCorrectionReflector', () => {
  it('非 turn-end 返 null', async () => {
    const r = new QuoteCorrectionReflector()
    const ctx = { ...turnEndCtx(), phase: 'post-step' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('outcome.toolNames 非空 返 null', async () => {
    const r = new QuoteCorrectionReflector()
    const ctx = { ...turnEndCtx(), outcome: { stepText: 'x', toolNames: ['bash'] } } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('session 无 tool result 返 null', async () => {
    mockListBySession.mockReturnValueOnce([])
    const r = new QuoteCorrectionReflector()
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })

  it('mask < 阈值 返 null', async () => {
    mockVerifyQuoted.mockReturnValue({ cleaned: 'x', unverifiedCount: 1 })
    mockVerifyEntity.mockReturnValue({ cleaned: 'x', ungroundedCount: 0 })
    const r = new QuoteCorrectionReflector({ maskThreshold: 2 })
    expect(await r.reflect(turnEndCtx())).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('mask >= 阈值 + confidence >= 0.5 → userOutput (替换 final + UI 渲染)', async () => {
    mockVerifyQuoted.mockReturnValue({ cleaned: 'x', unverifiedCount: 2 })
    mockVerifyEntity.mockReturnValue({ cleaned: 'x', ungroundedCount: 1 })
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ rewritten: 'corrected version', confidence: 0.8 }),
    })
    const r = new QuoteCorrectionReflector({ maskThreshold: 2 })
    const out = await r.reflect(turnEndCtx())
    expect(out?.userOutput).toBeDefined()
    expect(out!.userOutput!.label).toMatch(/^\[reflect-correction • 3 masked\]/)
    expect(out!.userOutput!.text).toBe('corrected version')
  })

  it('confidence < 0.5 → null (放行原文)', async () => {
    mockVerifyQuoted.mockReturnValue({ cleaned: 'x', unverifiedCount: 2 })
    mockVerifyEntity.mockReturnValue({ cleaned: 'x', ungroundedCount: 0 })
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ rewritten: 'r', confidence: 0.3 }),
    })
    const r = new QuoteCorrectionReflector({ maskThreshold: 2 })
    expect(await r.reflect(turnEndCtx())).toBeNull()
    expect(mockLedgerRecord).toHaveBeenCalled()
  })

  it('LLM 失败 → null', async () => {
    mockVerifyQuoted.mockReturnValue({ cleaned: 'x', unverifiedCount: 2 })
    mockVerifyEntity.mockReturnValue({ cleaned: 'x', ungroundedCount: 0 })
    mockGenerateText.mockRejectedValueOnce(new Error('LLM down'))
    const r = new QuoteCorrectionReflector({ maskThreshold: 2 })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })
})
