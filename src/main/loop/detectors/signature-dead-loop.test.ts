import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockRunForcedSummary } = vi.hoisted(() => ({
  mockRunForcedSummary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../forced-summary', () => ({
  runForcedSummary: mockRunForcedSummary,
  signatureDeadLoopSummaryOpts: vi.fn((sig: string, c: number, isErr: boolean) => ({
    label: `[sdl-${sig.slice(0, 4)}-${c}-${isErr}]`,
  })),
}))

import { SignatureDeadLoop } from './signature-dead-loop'
import type { OutcomeFacts } from '../outcome-facts'
import type { ForcedSummaryCtx } from '../forced-summary'

const stubCtx = {} as ForcedSummaryCtx

function facts(overrides: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: true,
    hasText: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: 'read#abc:def',
    ...overrides,
  }
}

describe('SignatureDeadLoop', () => {
  it('无 signature → 不触发', () => {
    const d = new SignatureDeadLoop(stubCtx)
    expect(d.observe(facts({ signature: '' })).triggered).toBe(false)
  })

  it('不同 signature → 不触发, 重置计数', () => {
    const d = new SignatureDeadLoop(stubCtx)
    expect(d.observe(facts({ signature: 'a' })).triggered).toBe(false)
    expect(d.observe(facts({ signature: 'b' })).triggered).toBe(false)
    expect(d.observe(facts({ signature: 'a' })).triggered).toBe(false)
  })

  it('带 error 同签名连续 2 次 (阈值 1) → 第 2 次触发', () => {
    const d = new SignatureDeadLoop(stubCtx)
    expect(d.observe(facts({ allToolsFailed: true })).triggered).toBe(false)
    const v = d.observe(facts({ allToolsFailed: true }))
    expect(v.triggered).toBe(true)
    expect(v.exitReason).toBe('repeated_error')
  })

  it('无 error 同签名 2 次 (阈值 2) → 仍不触发; 3 次才触发', () => {
    const d = new SignatureDeadLoop(stubCtx)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(true)
  })

  it('无 signature (中间步) 不 reset 计数', () => {
    const d = new SignatureDeadLoop(stubCtx)
    d.observe(facts({ signature: 'a', allToolsFailed: true })) // count=0
    // 穿插一步无工具调用
    expect(d.observe(facts({ signature: '' })).triggered).toBe(false)
    // 再来同签名 → 应当触发 (阈值 1)
    expect(d.observe(facts({ signature: 'a', allToolsFailed: true })).triggered).toBe(true)
  })

  it('opts.noErrorThreshold 覆盖默认阈值', () => {
    const d = new SignatureDeadLoop(stubCtx, { noErrorThreshold: 1 })
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(false)
    expect(d.observe(facts({ allToolsFailed: false })).triggered).toBe(true) // 第 2 次即触发
  })

  describe('Reflector 角色: 触发后 reflect 输出 wrapUp', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('verdict 触发后 reflect 返 wrapUp 含 runSummary + markFinal', async () => {
      const d = new SignatureDeadLoop(stubCtx)
      d.observe(facts({ allToolsFailed: true })) // count=0
      const v = d.observe(facts({ allToolsFailed: true })) // 触发
      expect(v.triggered).toBe(true)
      expect(v.exitReason).toBe('repeated_error')
      const ctx = {
        phase: 'post-step' as const,
        stepIndex: 0,
        userIntent: '',
        sessionId: '',
        abortSignal: new AbortController().signal,
        recentHistory: [],
        reflectModel: {} as never,
        facts: facts(),
        outcome: { stepText: '', toolNames: ['x'] } as never,
        raw: { stepText: '' },
      }
      const out = await d.reflect(ctx)
      expect(out?.wrapUp).toBeDefined()
      expect(out?.wrapUp?.markFinal).toBe(true)
    })

    it('reflect 内的 runSummary 调用 forced summary', async () => {
      const d = new SignatureDeadLoop(stubCtx)
      d.observe(facts({ allToolsFailed: true }))
      d.observe(facts({ allToolsFailed: true }))
      const ctx = {
        phase: 'post-step' as const,
        stepIndex: 0,
        userIntent: '',
        sessionId: '',
        abortSignal: new AbortController().signal,
        recentHistory: [],
        reflectModel: {} as never,
        facts: facts(),
        outcome: { stepText: '', toolNames: ['x'] } as never,
        raw: { stepText: '' },
      }
      const out = await d.reflect(ctx)
      await out!.wrapUp!.runSummary()
      expect(mockRunForcedSummary).toHaveBeenCalledTimes(1)
    })

    it('未触发时 reflect 返 null', async () => {
      const d = new SignatureDeadLoop(stubCtx)
      d.observe(facts({ allToolsFailed: false })) // 阈值 2, 未触发
      const ctx = {
        phase: 'post-step' as const,
        stepIndex: 0,
        userIntent: '',
        sessionId: '',
        abortSignal: new AbortController().signal,
        recentHistory: [],
        reflectModel: {} as never,
        facts: facts(),
        outcome: { stepText: '', toolNames: [] } as never,
        raw: { stepText: '' },
      }
      expect(await d.reflect(ctx)).toBeNull()
    })
  })
})
