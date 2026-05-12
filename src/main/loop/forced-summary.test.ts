import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((s: AbortSignal) => s),
}))

vi.mock('./quote-verifier', () => ({
  verifyQuotedFacts: vi.fn((cleaned: string) => ({ cleaned, unverifiedCount: 0 })),
  verifyEntityGrounding: vi.fn((cleaned: string) => ({ cleaned, ungroundedCount: 0 })),
}))

const { mockMessageCreate, mockMessageListBySession, mockSessionTouch, mockStreamText } =
  vi.hoisted(() => ({
    mockMessageCreate: vi.fn(),
    mockMessageListBySession: vi.fn(() => [] as unknown[]),
    mockSessionTouch: vi.fn(),
    mockStreamText: vi.fn(),
  }))

vi.mock('../repos/session-repo', () => ({
  messageRepo: { create: mockMessageCreate, listBySession: mockMessageListBySession },
  sessionRepo: { touch: mockSessionTouch },
}))

vi.mock('ai', () => ({ streamText: (...args: unknown[]) => mockStreamText(...args) }))

import {
  runForcedSummary,
  FALLBACK_SUMMARY_OPTS,
  failureStreakSummaryOpts,
  forcedClosureSummaryOpts,
  type ForcedSummaryCtx,
} from './forced-summary'

function makeCtx(): ForcedSummaryCtx {
  return {
    sessionId: 's1',
    userContent: 'test',
    mappedAttachments: [],
    abortSignal: new AbortController().signal,
    pipeline: {
      build: vi.fn().mockResolvedValue({ messages: [], tools: [] }),
    } as unknown as ForcedSummaryCtx['pipeline'],
    provider: {} as ForcedSummaryCtx['provider'],
    providerConfig: {} as ForcedSummaryCtx['providerConfig'],
    workspace: '/tmp',
    model: {} as ForcedSummaryCtx['model'],
    agent: {} as ForcedSummaryCtx['agent'],
    agentId: '__chat__',
    skillTracker: {} as ForcedSummaryCtx['skillTracker'],
    events: {} as ForcedSummaryCtx['events'],
    callbacks: { onTextDelta: vi.fn() },
  }
}

function mockTextStream(text: string) {
  mockStreamText.mockReturnValue({
    textStream: (async function* () {
      yield text
    })(),
  })
}

describe('runForcedSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('FALLBACK_SUMMARY_OPTS', () => {
    it('正常输出 → 落库带 [auto-summary] label', async () => {
      mockTextStream('the answer is X')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      expect(mockMessageCreate).toHaveBeenCalledTimes(1)
      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[auto-summary]')
      expect(text).toContain('the answer is X')
    })

    it('空输出 → 不落库 (fallback summary 设计)', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)
      expect(mockMessageCreate).not.toHaveBeenCalled()
    })
  })

  describe('failureStreakSummaryOpts', () => {
    it('正常输出 → 落库带 [failure-recovery] label', async () => {
      mockTextStream('failed because X')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[failure-recovery]')
      expect(text).toContain('failed because X')
    })

    it('空输出 → 用 fallbackTextIfEmpty', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('unable to complete the task after 3 consecutive tool failures')
    })
  })

  describe('forcedClosureSummaryOpts', () => {
    it('模型输出含 marker → 落库不补 ⏸', async () => {
      mockTextStream('summary ✓ Done')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[forced-closure]')
      expect(text).toContain('✓ Done')
      expect(text).not.toContain('please re-engage')
    })

    it('模型输出无 marker → 服务端补 ⏸ Blocked', async () => {
      mockTextStream('vague text')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[forced-closure]')
      expect(text).toContain('vague text')
      expect(text).toContain('⏸ Blocked')
      expect(text).toContain('please re-engage')
    })

    it('空输出 → 用 fallbackTextIfEmpty + 补 ⏸ Blocked', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('Cannot determine task state')
      expect(text).toContain('⏸ Blocked')
    })
  })

  describe('错误兜底', () => {
    it('pipeline.build 抛错 → 落 errorFallbackText', async () => {
      const ctx = makeCtx()
      ctx.pipeline.build = vi.fn().mockRejectedValue(new Error('build failed'))
      await runForcedSummary(ctx, 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[auto-halt]')
      expect(text).toContain('Task blocked by 3 consecutive tool failures')
    })

    it('forced-closure 错误兜底文案含 ⏸ Blocked', async () => {
      const ctx = makeCtx()
      ctx.pipeline.build = vi.fn().mockRejectedValue(new Error('boom'))
      await runForcedSummary(ctx, 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[forced-closure failed]')
      expect(text).toContain('⏸ Blocked')
    })
  })
})
