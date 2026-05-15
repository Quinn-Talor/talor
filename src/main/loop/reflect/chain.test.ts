import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { runReflectorChain } from './chain'
import type { Reflector, ReflectContext, ReflectorOutcome, ReflectPhase } from './types'

function ctx(
  phase: ReflectPhase = 'post-step',
  overrides: Partial<ReflectContext> = {},
): ReflectContext {
  const base = {
    phase,
    stepIndex: 0,
    userIntent: 'test',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: [],
    reflectModel: {} as never,
  }
  if (phase === 'pre-step') {
    return {
      ...base,
      phase: 'pre-step',
      estimatedTokens: 0,
      contextLimit: 100,
      messages: [],
      ...overrides,
    } as ReflectContext
  }
  if (phase === 'turn-end') {
    return {
      ...base,
      phase: 'turn-end',
      facts: {} as never,
      outcome: {} as never,
      raw: { stepText: '' },
      policyDecision: 'final',
      ...overrides,
    } as ReflectContext
  }
  return {
    ...base,
    phase: 'post-step',
    facts: {} as never,
    outcome: {} as never,
    raw: { stepText: '' },
    ...overrides,
  } as ReflectContext
}

function mockReflector(
  name: string,
  phases: ReflectPhase[],
  out: ReflectorOutcome | null,
  extras: Partial<Reflector['capabilities']> = {},
): Reflector {
  return {
    name,
    capabilities: { phases, ...extras },
    reflect: vi.fn().mockResolvedValue(out),
  }
}

describe('runReflectorChain — phase 过滤', () => {
  it('reflector phases 不含当前 phase → 跳过', async () => {
    const r = mockReflector('foo', ['turn-end'], { hint: 'x' })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res.kind).toBe('none')
  })

  it('reflector phases 含当前 phase → 调用', async () => {
    const r = mockReflector('foo', ['post-step'], { hint: 'x' })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res.kind).toBe('hint')
    expect(res.hint).toBe('x')
  })
})

describe('runReflectorChain — maxPerTurn 上限', () => {
  it('已达上限 → 跳过', async () => {
    const r = mockReflector('cap-r', ['post-step'], { hint: 'x' }, { maxPerTurn: 1 })
    const counters = new Map([['cap-r', 1]])
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), counters)
    expect(res.kind).toBe('none')
  })

  it('未达上限 → 调用并 bump counter', async () => {
    const r = mockReflector('cap-r', ['post-step'], { hint: 'x' }, { maxPerTurn: 2 })
    const counters = new Map([['cap-r', 1]])
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), counters)
    expect(res.kind).toBe('hint')
    expect(counters.get('cap-r')).toBe(2)
  })

  it('返 null 不 bump counter', async () => {
    const r = mockReflector('cap-r', ['post-step'], null)
    const counters = new Map<string, number>()
    await runReflectorChain('post-step', [r], ctx('post-step'), counters)
    expect(counters.get('cap-r')).toBeUndefined()
  })
})

describe('runReflectorChain — priority 排序', () => {
  it('priority 数字小先跑, 第一个非 null wins', async () => {
    const r1 = mockReflector('first', ['post-step'], { hint: 'A' }, { priority: 100 })
    const r2 = mockReflector('second', ['post-step'], { hint: 'B' }, { priority: 10 })
    const res = await runReflectorChain('post-step', [r1, r2], ctx('post-step'), new Map())
    expect(res.from).toBe('second')
    expect(res.hint).toBe('B')
  })
})

describe('runReflectorChain — 第一个非 null wins', () => {
  it('多 reflector 返非 null, 取第一个', async () => {
    const r1 = mockReflector('r1', ['post-step'], null)
    const r2 = mockReflector('r2', ['post-step'], { hint: 'A' })
    const r3 = mockReflector('r3', ['post-step'], { hint: 'B' })
    const counters = new Map<string, number>()
    const res = await runReflectorChain('post-step', [r1, r2, r3], ctx('post-step'), counters)
    expect(res.from).toBe('r2')
    expect(r3.reflect).not.toHaveBeenCalled()
  })
})

describe('runReflectorChain — 异常静默', () => {
  it('reflect throw → 跳过该 reflector, 不阻塞链', async () => {
    const r1: Reflector = {
      name: 'throwing',
      capabilities: { phases: ['post-step'] },
      reflect: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const r2 = mockReflector('fallback', ['post-step'], { hint: 'OK' })
    const res = await runReflectorChain('post-step', [r1, r2], ctx('post-step'), new Map())
    expect(res.from).toBe('fallback')
    expect(res.hint).toBe('OK')
  })
})

describe('runReflectorChain — 输出形态', () => {
  it('wrapUp 输出', async () => {
    const r = mockReflector('w', ['post-step'], {
      wrapUp: { exitReason: 'repeated_error', runSummary: async () => {} },
    })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res.kind).toBe('wrap_up')
    expect(res.wrapUp).toBeDefined()
  })

  it('userOutput 输出 → kind=user_output', async () => {
    const r = mockReflector('d', ['post-step'], {
      userOutput: {
        text: 'x',
        label: '[d]',
        reason: 'r',
      },
    })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res.kind).toBe('user_output')
    expect(res.userOutput?.text).toBe('x')
  })

  it('internalNudge 输出 → kind=internal_nudge', async () => {
    const r = mockReflector('n', ['post-step'], {
      internalNudge: {
        text: 'nudge text',
        label: '[reflection-judge]',
        reason: 'r',
        role: 'user',
      },
    })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res.kind).toBe('internal_nudge')
    expect(res.internalNudge?.text).toBe('nudge text')
    expect(res.internalNudge?.role).toBe('user')
  })

  it('两种 output 同时存在: userOutput 优先 (用户回复 > 内部纠正)', async () => {
    const r = mockReflector('both', ['post-step'], {
      userOutput: { text: 'user', label: '[u]', reason: 'r' },
      internalNudge: { text: 'nudge', label: '[n]', reason: 'r', role: 'user' },
    })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res.kind).toBe('user_output')
  })
})
