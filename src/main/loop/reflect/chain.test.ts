import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_TRACE_CONFIG, type ObservationRecord } from '@shared/types/trace'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { runReflectorChain } from './chain'
import { traceRecorder } from '../../observe/trace-recorder'
import { traceRepo } from '../../repos/trace-repo'
import { runInScope } from '../../observe/trace-context'
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

// ── guard observation（turn-trace TASK-4）─────────────────────────────

describe('runReflectorChain — guard observations', () => {
  let rows: Map<string, ObservationRecord>

  beforeEach(() => {
    rows = new Map()
    vi.spyOn(traceRepo, 'upsertBatch').mockImplementation((_t, observations) => {
      for (const o of observations) rows.set(o.id, { ...o })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function traced(id: string, fn: () => Promise<unknown>): Promise<ObservationRecord[]> {
    const scope = traceRecorder.startTrace({
      id,
      sessionId: 's1',
      name: 'turn',
      input: 'x',
      rootName: 'agent:test',
      config: DEFAULT_TRACE_CONFIG,
    })
    await runInScope(scope, fn)
    traceRecorder.endTrace(id, {})
    return [...rows.values()].filter((o) => o.type !== 'AGENT')
  }

  it('one observation per evaluated reflector; level follows the outcome; type follows usesLlm', async () => {
    const reflectors = [
      mockReflector('quiet', ['post-step'], null, { priority: 1 }),
      mockReflector(
        'llm-judge',
        ['post-step'],
        { hint: 'look again' },
        { priority: 2, usesLlm: true },
      ),
      mockReflector('never-reached', ['post-step'], { hint: 'x' }, { priority: 3 }),
    ]
    const obs = await traced('t-guards', () =>
      runReflectorChain('post-step', reflectors, ctx('post-step'), new Map()),
    )
    expect(obs.map((o) => o.name)).toEqual(['guard:quiet', 'guard:llm-judge'])
    expect(obs[0]).toMatchObject({ type: 'GUARDRAIL', level: 'DEBUG' })
    expect(obs[0].metadata).toMatchObject({
      phase: 'post-step',
      outcome: 'none',
      per_turn_index: 1,
    })
    expect(obs[1]).toMatchObject({ type: 'EVALUATOR', level: 'DEFAULT', output: 'look again' })
    expect(obs[1].metadata.outcome).toBe('hint')
  })

  it('wrap_up / user_output outcomes are WARNING; a throwing reflector is ERROR', async () => {
    const wrap = mockReflector('wrapper', ['post-step'], {
      wrapUp: { runSummary: async () => {}, exitReason: 'repeated_error', markFinal: true },
    } as ReflectorOutcome)
    const obsWrap = await traced('t-wrap', () =>
      runReflectorChain('post-step', [wrap], ctx('post-step'), new Map()),
    )
    expect(obsWrap[0]).toMatchObject({ level: 'WARNING' })
    expect(obsWrap[0].metadata.outcome).toBe('wrap_up')

    rows.clear()
    const boom: Reflector = {
      name: 'boom',
      capabilities: { phases: ['post-step'] },
      reflect: vi.fn().mockRejectedValue(new Error('reflect failed')),
    }
    const obsErr = await traced('t-throw', () =>
      runReflectorChain('post-step', [boom], ctx('post-step'), new Map()),
    )
    expect(obsErr[0]).toMatchObject({ level: 'ERROR', status_message: 'reflect failed' })
  })

  it('pre-step guards record the context budget (estimated tokens vs context limit)', async () => {
    const budget = mockReflector('context-budget', ['pre-step'], null)
    const obs = await traced('t-budget', () =>
      runReflectorChain(
        'pre-step',
        [budget],
        ctx('pre-step', { estimatedTokens: 91_000, contextLimit: 128_000 }),
        new Map(),
      ),
    )
    expect(obs[0].metadata).toMatchObject({ estimated_tokens: 91_000, context_limit: 128_000 })
  })

  it('(no-trigger) post-step guards carry no context-budget fields', async () => {
    const quiet = mockReflector('quiet', ['post-step'], null)
    const obs = await traced('t-nobudget', () =>
      runReflectorChain('post-step', [quiet], ctx('post-step'), new Map()),
    )
    expect(obs[0].metadata).not.toHaveProperty('estimated_tokens')
    expect(obs[0].metadata).not.toHaveProperty('context_limit')
  })

  it('a reflector over maxPerTurn emits a DEBUG guard.skipped event instead of a guard', async () => {
    const capped = mockReflector('capped', ['post-step'], { hint: 'x' }, { maxPerTurn: 1 })
    const obs = await traced('t-skip', () =>
      runReflectorChain('post-step', [capped], ctx('post-step'), new Map([['capped', 1]])),
    )
    expect(obs).toHaveLength(1)
    expect(obs[0]).toMatchObject({ type: 'EVENT', name: 'guard.skipped', level: 'DEBUG' })
    expect(obs[0].metadata).toEqual({ reflector: 'capped', phase: 'post-step', used: 1 })
  })

  it('work done inside reflect() is parented to the guard observation', async () => {
    const nested: Reflector = {
      name: 'nested',
      capabilities: { phases: ['post-step'] },
      reflect: vi.fn(async () => {
        traceRecorder.startObservation({ type: 'GENERATION', name: 'llm:reflect:x' }).end()
        return null
      }),
    }
    const obs = await traced('t-nested', () =>
      runReflectorChain('post-step', [nested], ctx('post-step'), new Map()),
    )
    const guard = obs.find((o) => o.name === 'guard:nested')!
    const gen = obs.find((o) => o.type === 'GENERATION')!
    expect(gen.parent_observation_id).toBe(guard.id)
  })

  it('without a trace scope the chain behaves exactly as before', async () => {
    const r = mockReflector('foo', ['post-step'], { hint: 'x' })
    const res = await runReflectorChain('post-step', [r], ctx('post-step'), new Map())
    expect(res).toEqual({ kind: 'hint', from: 'foo', hint: 'x' })
    expect(traceRepo.upsertBatch).not.toHaveBeenCalled()
  })
})
