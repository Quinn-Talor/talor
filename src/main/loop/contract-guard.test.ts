// src/main/loop/contract-guard.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { verify, applyRetryPolicy, extractDeliverable } from './contract-guard'
import type { ToolEvent } from './contract-guard'
import type {
  AcceptanceCriterion,
  AgentProfile,
  RetryPolicy,
  Deliverable,
} from '@shared/types/agent'

const REVIEW_PROFILE: AgentProfile = {
  schemaVersion: '1.0',
  identity: { id: 'reviewer', name: 'R', description: 'r', version: '1.0.0' },
  mission: {
    objective: 'review',
    outcomes: [
      {
        id: 'r',
        description: 'r',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'review_report',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  },
  method: { capabilities: ['review'] },
  delivery: {
    deliverables: [
      {
        id: 'review_report',
        format: 'json',
        schema: {
          type: 'object',
          required: ['summary', 'findings'],
          properties: { summary: { type: 'string' }, findings: { type: 'array' } },
        },
        extractFrom: { type: 'json-fenced-block', firstOrLast: 'last' },
      },
    ],
    acceptance: [],
  },
  execution: {
    limits: { maxSteps: 10, maxTokens: 10000 },
    retryPolicy: { maxAttempts: 2, onMustFail: 'retry-then-mark', onShouldFail: 'mark-only' },
  },
}

function makeAgent(
  profile: AgentProfile = REVIEW_PROFILE,
  toolExec?: (n: string, i: unknown) => Promise<unknown>,
) {
  return {
    profile,
    toolRegistry: {
      execute: async (name: string, input: unknown) =>
        toolExec ? toolExec(name, input) : { __talor_error: true, message: `unknown tool ${name}` },
    },
  }
}

describe('verify — deliverable-present', () => {
  const c: AcceptanceCriterion = {
    type: 'deliverable-present',
    deliverableId: 'review_report',
    kind: 'deterministic',
    severity: 'must',
  }

  it('AC-060: missing deliverable → fail', async () => {
    const r = await verify([c], {
      finalText: 'no json here',
      toolEvents: [],
      agent: makeAgent(),
    })
    expect(r.passed).toBe(false)
    expect(r.failures[0].reason).toMatch(/not found in output/)
  })

  it('valid JSON fenced block matches schema → pass', async () => {
    const r = await verify([c], {
      finalText: '```json\n{"summary":"ok","findings":[]}\n```',
      toolEvents: [],
      agent: makeAgent(),
    })
    expect(r.passed).toBe(true)
  })

  it('JSON fenced block missing required field → fail', async () => {
    const r = await verify([c], {
      finalText: '```json\n{"summary":"ok"}\n```',
      toolEvents: [],
      agent: makeAgent(),
    })
    expect(r.passed).toBe(false)
    expect(r.failures[0].reason).toBe('schema mismatch')
  })
})

describe('verify — tool-was-used', () => {
  it('AC-061: read tool was called → pass', async () => {
    const c: AcceptanceCriterion = {
      type: 'tool-was-used',
      toolName: 'read',
      kind: 'deterministic',
      severity: 'must',
    }
    const events: ToolEvent[] = [{ toolName: 'read', input: { path: 'a.md' } }]
    const r = await verify([c], { finalText: '', toolEvents: events, agent: makeAgent() })
    expect(r.passed).toBe(true)
  })

  it('read tool not called → fail', async () => {
    const c: AcceptanceCriterion = {
      type: 'tool-was-used',
      toolName: 'read',
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], { finalText: '', toolEvents: [], agent: makeAgent() })
    expect(r.passed).toBe(false)
  })

  it('implicit acceptance: read tool input.path must include _knowledgePath', async () => {
    const c: AcceptanceCriterion = {
      type: 'tool-was-used',
      toolName: 'read',
      kind: 'deterministic',
      severity: 'must',
      _implicit: true,
      _knowledgePath: 'rules.md',
    }
    const events: ToolEvent[] = [{ toolName: 'read', input: { path: 'src/rules.md' } }]
    const r = await verify([c], { finalText: '', toolEvents: events, agent: makeAgent() })
    expect(r.passed).toBe(true)
  })

  it('implicit acceptance: read on wrong path fails', async () => {
    const c: AcceptanceCriterion = {
      type: 'tool-was-used',
      toolName: 'read',
      kind: 'deterministic',
      severity: 'must',
      _implicit: true,
      _knowledgePath: 'rules.md',
    }
    const events: ToolEvent[] = [{ toolName: 'read', input: { path: 'other.md' } }]
    const r = await verify([c], { finalText: '', toolEvents: events, agent: makeAgent() })
    expect(r.passed).toBe(false)
    expect(r.failures[0].reason).toMatch(/did not read "rules.md"/)
  })
})

describe('verify — tool-not-used', () => {
  it('AC-062: write tool was called → fail', async () => {
    const c: AcceptanceCriterion = {
      type: 'tool-not-used',
      toolName: 'write',
      kind: 'deterministic',
      severity: 'must',
    }
    const events: ToolEvent[] = [{ toolName: 'write', input: { path: 'x.txt' } }]
    const r = await verify([c], { finalText: '', toolEvents: events, agent: makeAgent() })
    expect(r.passed).toBe(false)
    expect(r.failures[0].reason).toMatch(/write was called/)
  })

  it('write tool not called → pass', async () => {
    const c: AcceptanceCriterion = {
      type: 'tool-not-used',
      toolName: 'write',
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], { finalText: '', toolEvents: [], agent: makeAgent() })
    expect(r.passed).toBe(true)
  })
})

describe('verify — output-matches', () => {
  it('AC-063: schema match against extracted JSON', async () => {
    const c: AcceptanceCriterion = {
      type: 'output-matches',
      schema: { type: 'object', required: ['x'] },
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], {
      finalText: '```json\n{"x":1}\n```',
      toolEvents: [],
      agent: makeAgent(),
    })
    expect(r.passed).toBe(true)
  })

  it('pattern not matched → fail', async () => {
    const c: AcceptanceCriterion = {
      type: 'output-matches',
      pattern: 'verdict: (approve|request-changes)',
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], { finalText: 'just text', toolEvents: [], agent: makeAgent() })
    expect(r.passed).toBe(false)
  })
})

describe('verify — verifier-tool', () => {
  it('verifier returns pass:true → pass', async () => {
    const c: AcceptanceCriterion = {
      type: 'verifier-tool',
      toolName: 'check',
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], {
      finalText: '',
      toolEvents: [],
      agent: makeAgent(REVIEW_PROFILE, async () => ({ pass: true })),
    })
    expect(r.passed).toBe(true)
  })

  it('verifier returns pass:false → fail', async () => {
    const c: AcceptanceCriterion = {
      type: 'verifier-tool',
      toolName: 'check',
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], {
      finalText: '',
      toolEvents: [],
      agent: makeAgent(REVIEW_PROFILE, async () => ({ pass: false, reason: 'too few citations' })),
    })
    expect(r.passed).toBe(false)
    expect(r.failures[0].reason).toBe('too few citations')
  })

  it('verifier envelope error → fail', async () => {
    const c: AcceptanceCriterion = {
      type: 'verifier-tool',
      toolName: 'check',
      kind: 'deterministic',
      severity: 'must',
    }
    const r = await verify([c], {
      finalText: '',
      toolEvents: [],
      agent: makeAgent(REVIEW_PROFILE, async () => ({
        __talor_error: true,
        message: 'tool crashed',
      })),
    })
    expect(r.passed).toBe(false)
    expect(r.failures[0].reason).toBe('tool crashed')
  })
})

describe('extractDeliverable', () => {
  it('json-fenced-block last → returns parsed last block', () => {
    const text = '```json\n{"a":1}\n```\n```json\n{"b":2}\n```'
    const out = extractDeliverable(
      text,
      {
        id: 'x',
        format: 'json',
        extractFrom: { type: 'json-fenced-block', firstOrLast: 'last' },
      } as Deliverable,
      [],
    )
    expect(out).toEqual({ b: 2 })
  })

  it('json-fenced-block first', () => {
    const text = '```json\n{"a":1}\n```\n```json\n{"b":2}\n```'
    const out = extractDeliverable(
      text,
      {
        id: 'x',
        format: 'json',
        extractFrom: { type: 'json-fenced-block', firstOrLast: 'first' },
      } as Deliverable,
      [],
    )
    expect(out).toEqual({ a: 1 })
  })

  it('last-message returns full text', () => {
    const out = extractDeliverable(
      'hello world',
      { id: 'x', format: 'markdown', extractFrom: { type: 'last-message' } } as Deliverable,
      [],
    )
    expect(out).toBe('hello world')
  })

  it('regex-capture with group', () => {
    const out = extractDeliverable(
      'verdict: approve, line: 42',
      {
        id: 'x',
        format: 'text',
        extractFrom: { type: 'regex-capture', pattern: 'verdict: (\\w+)', group: 1 },
      } as Deliverable,
      [],
    )
    expect(out).toBe('approve')
  })

  it('tool-result picks last matching tool event', () => {
    const events: ToolEvent[] = [
      { toolName: 'read', result: 'first' },
      { toolName: 'check', result: 'middle' },
      { toolName: 'read', result: 'last' },
    ]
    const out = extractDeliverable(
      '',
      {
        id: 'x',
        format: 'text',
        extractFrom: { type: 'tool-result', toolName: 'read' },
      } as Deliverable,
      events,
    )
    expect(out).toBe('last')
  })

  it('json without fenced block returns null', () => {
    const out = extractDeliverable(
      'hello',
      { id: 'x', format: 'json', extractFrom: { type: 'json-fenced-block' } } as Deliverable,
      [],
    )
    expect(out).toBeNull()
  })
})

describe('applyRetryPolicy', () => {
  const POLICY: RetryPolicy = {
    maxAttempts: 2,
    onMustFail: 'retry-then-mark',
    onShouldFail: 'mark-only',
  }

  function failures(
    severity: 'must' | 'should' = 'must',
  ): import('./contract-guard').VerifyFailure[] {
    return [
      {
        criterion: {
          type: 'deliverable-present',
          deliverableId: 'r',
          kind: 'deterministic',
          severity,
        },
        reason: 'missing',
      },
    ]
  }

  it('AC-064: must failure within maxAttempts → retry', () => {
    const d = applyRetryPolicy(POLICY, failures('must'), 1)
    expect(d.action).toBe('retry')
    expect(d.hint).toMatch(/Acceptance retry/i)
  })

  it('AC-065: must failure at maxAttempts + retry-then-mark → mark-failed', () => {
    const d = applyRetryPolicy(POLICY, failures('must'), 2)
    expect(d.action).toBe('mark-failed')
    expect(d.metadata?.dod_failed).toBe(true)
  })

  it('retry-then-escalate at maxAttempts → escalate', () => {
    const policy: RetryPolicy = {
      ...POLICY,
      onMustFail: 'retry-then-escalate',
      escalateTo: { id: 'human' },
    }
    const d = applyRetryPolicy(policy, failures('must'), 2)
    expect(d.action).toBe('escalate')
    expect((d.metadata?.escalateTo as { id: string }).id).toBe('human')
  })

  it('abort at maxAttempts', () => {
    const policy: RetryPolicy = { ...POLICY, onMustFail: 'abort' }
    const d = applyRetryPolicy(policy, failures('must'), 2)
    expect(d.action).toBe('abort')
  })

  it('only should failures → mark-only without retry', () => {
    const d = applyRetryPolicy(POLICY, failures('should'), 1)
    expect(d.action).toBe('mark-failed')
    expect(d.metadata?.dod_failed).toBe(false)
  })

  it('should failure with retry-once policy', () => {
    const policy: RetryPolicy = { ...POLICY, onShouldFail: 'retry-once' }
    const d1 = applyRetryPolicy(policy, failures('should'), 1)
    expect(d1.action).toBe('retry')
    const d2 = applyRetryPolicy(policy, failures('should'), 2)
    expect(d2.action).toBe('mark-failed')
  })
})

describe('verify — empty acceptance', () => {
  it('empty list → trivially passed', async () => {
    const r = await verify([], {
      finalText: '',
      toolEvents: [],
      agent: makeAgent(),
    })
    expect(r.passed).toBe(true)
    expect(r.failures).toEqual([])
  })
})
