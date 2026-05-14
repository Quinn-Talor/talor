// src/main/loop/turn-end-policies/policies.test.ts —— 单 policy + chain 行为
//
// 测试覆盖 (v4 Phase 4a 后):
//   - SdkFinishReasonPolicy 5 分支 (tool-calls / length / content-filter / stop / error+other)
//   - ExplicitTerminationBlockPolicy (done/need_input/blocked)
//   - LegacyNaturalFinalPolicy (永远 final + 永不 no-opinion)
//   - runPolicyChain 顺序生效 + 链末 legacy 兜底 + 单个 policy throw fail-open
//
// 已移除 (Phase 4a):
//   - PendingContinuationBlockPolicy — pending_continuation block 退役

import { describe, it, expect } from 'vitest'
import {
  SdkFinishReasonPolicy,
  ExplicitTerminationBlockPolicy,
  LegacyNaturalFinalPolicy,
  runPolicyChain,
  buildDefaultChain,
  type PolicyContext,
  type TurnEndPolicy,
} from './index'
import type { StepOutcome } from '../types'
import type { FinishReason } from 'ai'

function mockCtx(opts: Partial<PolicyContext['sdkSignals']> = {}): PolicyContext {
  return {
    agent: {} as PolicyContext['agent'], // unused in tests
    sessionId: 's1',
    stepIndex: 0,
    abortSignal: new AbortController().signal,
    sdkSignals: {
      finishReason: 'stop' as FinishReason,
      ...opts,
    },
  }
}

function mockOutcome(stepText = ''): StepOutcome {
  return {
    stepText,
    wroteAssistantFinal: false,
    shouldContinue: false,
    durationMs: 100,
    toolNames: [],
    signature: '',
    allToolsFailed: null,
    containsSubagentFailure: false,
  }
}

describe('SdkFinishReasonPolicy', () => {
  const policy = new SdkFinishReasonPolicy()

  it('finishReason="tool-calls" → no-opinion (不该到 turn-end 链)', async () => {
    const d = await policy.evaluate(mockOutcome('hi'), mockCtx({ finishReason: 'tool-calls' }))
    expect(d.action).toBe('no-opinion')
  })

  it('finishReason="length" → continue + truncation hint + exitReason=truncated', async () => {
    const d = await policy.evaluate(mockOutcome('partial'), mockCtx({ finishReason: 'length' }))
    expect(d.action).toBe('continue')
    expect(d.exitReason).toBe('truncated')
    expect(d.injectHint).toBeDefined()
    expect(d.injectHint!).toMatch(/truncated/i)
    expect(d.injectHint!).toMatch(/max_tokens/)
  })

  it('finishReason="content-filter" → final + exitReason=content_filter', async () => {
    const d = await policy.evaluate(mockOutcome('hi'), mockCtx({ finishReason: 'content-filter' }))
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('content_filter')
  })

  it('finishReason="stop" → no-opinion (落到 P1/P2/P3 兜底)', async () => {
    const d = await policy.evaluate(mockOutcome('hi'), mockCtx({ finishReason: 'stop' }))
    expect(d.action).toBe('no-opinion')
  })

  it.each(['error', 'other'] as const)(
    'finishReason="%s" → no-opinion (fail-open)',
    async (reason) => {
      const d = await policy.evaluate(mockOutcome('hi'), mockCtx({ finishReason: reason }))
      expect(d.action).toBe('no-opinion')
    },
  )
})

describe('ExplicitTerminationBlockPolicy', () => {
  const policy = new ExplicitTerminationBlockPolicy()

  it('含 done block → final + declared_final', async () => {
    const text = 'OK.\n```talor\n{"type":"done","summary":"all set"}\n```'
    const d = await policy.evaluate(mockOutcome(text), mockCtx())
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('declared_final')
    expect(d.reason).toContain('done')
  })

  it('含 need_input block → final + declared_final', async () => {
    const text = '请选\n```talor\n{"type":"need_input","question":"哪个?"}\n```'
    const d = await policy.evaluate(mockOutcome(text), mockCtx())
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('declared_final')
  })

  it('含 blocked block → final + declared_final', async () => {
    const text = '失败\n```talor\n{"type":"blocked","reason":"network"}\n```'
    const d = await policy.evaluate(mockOutcome(text), mockCtx())
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('declared_final')
  })

  it('无 terminal block → no-opinion', async () => {
    const d = await policy.evaluate(mockOutcome('just text'), mockCtx())
    expect(d.action).toBe('no-opinion')
  })

  // v4 Phase 4a: pending_continuation block 已删除,parser 归入 invalid,
  // ExplicitTerminationBlockPolicy 拿不到此 block,直接 no-opinion (无任何已知 terminal block)
  it('legacy pending_continuation block (deprecated) → no-opinion', async () => {
    const text = '稍候\n```talor\n{"type":"pending_continuation"}\n```'
    const d = await policy.evaluate(mockOutcome(text), mockCtx())
    expect(d.action).toBe('no-opinion')
  })
})

describe('LegacyNaturalFinalPolicy', () => {
  const policy = new LegacyNaturalFinalPolicy()

  it('任意 outcome → final + no_tool_calls', async () => {
    const d = await policy.evaluate(mockOutcome(''), mockCtx())
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('no_tool_calls')
  })

  it('永远不返 no-opinion (链末兜底)', async () => {
    const d1 = await policy.evaluate(mockOutcome('hi'), mockCtx({ finishReason: 'stop' }))
    const d2 = await policy.evaluate(mockOutcome('hi'), mockCtx({ finishReason: 'length' }))
    expect(d1.action).toBe('final')
    expect(d2.action).toBe('final')
  })
})

describe('runPolicyChain', () => {
  it('第一个非 no-opinion wins (顺序优先级)', async () => {
    const chain = buildDefaultChain()
    // finishReason='length' → P0 SdkFinishReasonPolicy 直接 continue
    // 即便后面有 done block,也不会到 P1
    const text = '```talor\n{"type":"done","summary":"x"}\n```'
    const d = await runPolicyChain(chain, mockOutcome(text), mockCtx({ finishReason: 'length' }))
    expect(d.action).toBe('continue')
    expect(d.exitReason).toBe('truncated')
  })

  it('全 no-opinion 时 LegacyNaturalFinalPolicy 兜底', async () => {
    const chain = buildDefaultChain()
    // 普通文本 + stop → P0/P1/P2 全 no-opinion → P3 legacy
    const d = await runPolicyChain(
      chain,
      mockOutcome('just text'),
      mockCtx({ finishReason: 'stop' }),
    )
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('no_tool_calls')
  })

  it('done block + stop → P1 ExplicitTerminationBlockPolicy 命中', async () => {
    const chain = buildDefaultChain()
    const text = '```talor\n{"type":"done","summary":"x"}\n```'
    const d = await runPolicyChain(chain, mockOutcome(text), mockCtx({ finishReason: 'stop' }))
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('declared_final')
  })

  it('legacy pending_continuation block (deprecated) + stop → P2 legacy fallback (no continue)', async () => {
    // v4 Phase 4a: pending_continuation block 退役。老 session 含此 block 时,
    // parser 归入 invalid → 链中无任何 policy 命中 → legacy 兜底 final。
    const chain = buildDefaultChain()
    const text = '```talor\n{"type":"pending_continuation"}\n```'
    const d = await runPolicyChain(chain, mockOutcome(text), mockCtx({ finishReason: 'stop' }))
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('no_tool_calls')
  })

  it('单个 policy throw → fail-open,继续下一个', async () => {
    const throwingPolicy: TurnEndPolicy = {
      name: 'throwing',
      async evaluate() {
        throw new Error('boom')
      },
    }
    const fallback: TurnEndPolicy = {
      name: 'fallback',
      async evaluate() {
        return { action: 'final', exitReason: 'no_tool_calls', reason: 'fallback' }
      },
    }
    const d = await runPolicyChain([throwingPolicy, fallback], mockOutcome(''), mockCtx())
    expect(d.action).toBe('final')
    expect(d.reason).toBe('fallback')
  })

  it('所有 policy 都返 no-opinion 时返保守 final (防御性)', async () => {
    const onlyNoOpinion: TurnEndPolicy[] = [
      {
        name: 'a',
        async evaluate() {
          return { action: 'no-opinion', reason: '' }
        },
      },
      {
        name: 'b',
        async evaluate() {
          return { action: 'no-opinion', reason: '' }
        },
      },
    ]
    const d = await runPolicyChain(onlyNoOpinion, mockOutcome(''), mockCtx())
    expect(d.action).toBe('final')
    expect(d.exitReason).toBe('no_tool_calls')
    expect(d.reason).toContain('unexpected')
  })
})

describe('buildDefaultChain', () => {
  it('v4 Phase 4a 链含 3 个 policy (无 judge / 无 pending-continuation), 末尾是 LegacyNaturalFinalPolicy', () => {
    const chain = buildDefaultChain()
    expect(chain).toHaveLength(3)
    expect(chain[0].name).toBe('sdk-finish-reason')
    expect(chain[1].name).toBe('explicit-termination')
    expect(chain[2].name).toBe('legacy-natural-final')
  })
})
