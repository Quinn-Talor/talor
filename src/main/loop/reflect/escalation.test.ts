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
import { ToolOnlyLoopReflector } from './tool-only-loop'
import { runReflectorChain } from './chain'
import type { Reflector, ReflectContext } from './types'

/** chain 的调用顺序: 先 track 推进状态, 再 reflect 产出。 */
function observeAndReflect(r: Reflector, c: ReflectContext) {
  r.track?.(c)
  return r.reflect(c)
}

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
    expect(await observeAndReflect(r, postCtx(0))).toBeNull() // streak=1
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
    await observeAndReflect(r, postCtx(0)) // streak=1
    const out = await observeAndReflect(r, postCtx(1)) // streak=2 触发
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
    await observeAndReflect(r, postCtx(0)) // streak=1
    await observeAndReflect(r, postCtx(1)) // streak=2 触发, reset
    expect(await observeAndReflect(r, postCtx(2))).toBeNull() // streak=1 again, not triggered
  })

  it('上步无 L1 hint → streak reset 为 0', async () => {
    let hinted = true
    const r = new EscalationReflector({
      threshold: 2,
      wasPreviousStepL1Hinted: () => hinted,
    })
    await observeAndReflect(r, postCtx(0)) // streak=1
    hinted = false
    await observeAndReflect(r, postCtx(1)) // reset
    hinted = true
    expect(await observeAndReflect(r, postCtx(2))).toBeNull() // streak=1, not triggered
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
    await observeAndReflect(r, postCtx(0))
    expect(await observeAndReflect(r, postCtx(1))).toBeNull()
    expect(mockLedgerRecord).toHaveBeenCalled()
  })
})

describe('EscalationReflector — 与 tool-only-loop 同链 (react-loop 排序)', () => {
  function toolOnlyCtx(stepIndex: number, hasText = false): ReflectContext {
    return {
      ...(postCtx(stepIndex) as Extract<ReflectContext, { phase: 'post-step' }>),
      facts: {
        hasToolCall: true,
        hasText,
        allToolsFailed: false,
        isSubagentFailure: false,
        signature: `s${stepIndex}`,
      },
    }
  }

  /** 模拟 react-loop: 每步跑 chain, 据产出来源更新 lastL1Hinted。 */
  async function runSteps(n: number, withText: boolean): Promise<string[]> {
    let lastL1Hinted = false
    const chain = [
      new EscalationReflector({ wasPreviousStepL1Hinted: () => lastL1Hinted }),
      new ToolOnlyLoopReflector({ hintAt: 3 }),
    ]
    const counters = new Map<string, number>()
    const froms: string[] = []
    for (let i = 0; i < n; i++) {
      const res = await runReflectorChain('post-step', chain, toolOnlyCtx(i, withText), counters)
      froms.push(res.from ?? '-')
      lastL1Hinted = res.kind === 'hint' && res.from === 'tool-only-loop'
    }
    return froms
  }

  it('tool-only-loop 每步出 hint 期间, L1 hint 连续 2 步被忽略 → escalation 升级顶替', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        progressSoFar: 'p',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: 'g',
        confidence: 0.8,
      }),
    })
    const froms = await runSteps(6, false)
    // step2/3: L1 hint; step4: 上两步均 L1 hinted → 升级
    expect(froms.slice(0, 5)).toEqual(['-', '-', 'tool-only-loop', 'tool-only-loop', 'escalation'])
  })

  it('(不触发) 每步都有文本 → 无 L1 hint, escalation 不调 LLM', async () => {
    const froms = await runSteps(6, true)
    expect(froms.every((f) => f === '-')).toBe(true)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })
})
