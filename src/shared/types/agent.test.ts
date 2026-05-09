// src/shared/types/agent.test.ts — Schema 1.0 type smoke tests
import { describe, it, expect } from 'vitest'
import type {
  AgentProfile,
  Outcome,
  KnowledgeRef,
  ToolDependency,
  AcceptanceCriterion,
  Deliverable,
  ExtractRule,
  MissionInput,
  WorkflowStep,
} from './agent'
import { SCHEMA_VERSION } from './agent'

describe('AgentProfile schema 1.0', () => {
  it('exports SCHEMA_VERSION = "1.0"', () => {
    expect(SCHEMA_VERSION).toBe('1.0')
  })

  it('accepts a complete business agent profile', () => {
    const profile: AgentProfile = {
      schemaVersion: '1.0',
      identity: {
        id: 'code_reviewer',
        name: 'Code Reviewer',
        description: 'Reviews PRs',
        version: '1.0.0',
      },
      mission: {
        objective: 'Produce structured PR review',
        outcomes: [
          {
            id: 'review_done',
            description: 'User receives review report',
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
      method: {
        capabilities: ['Apply standards.md rules'],
        tools: [{ name: 'read', required: true }],
      },
      delivery: {
        deliverables: [
          {
            id: 'review_report',
            format: 'json',
            schema: { type: 'object' },
          },
        ],
      },
      execution: {
        limits: { maxSteps: 30, maxTokens: 200000 },
        retryPolicy: {
          maxAttempts: 2,
          onMustFail: 'retry-then-mark',
          onShouldFail: 'mark-only',
        },
      },
    }
    expect(profile.schemaVersion).toBe('1.0')
    expect(profile.identity.id).toBe('code_reviewer')
  })

  it('accepts platform agent with empty mission/delivery', () => {
    const platform: AgentProfile = {
      schemaVersion: '1.0',
      identity: {
        id: '__chat__',
        name: 'Talor',
        description: 'Default assistant',
        version: '0.2.0',
      },
      mission: { objective: 'Help with any task', outcomes: [] },
      method: {
        capabilities: ['General conversation'],
        collaboration: { allowAnyBusinessSubagent: true },
      },
      delivery: { deliverables: [] },
      execution: {
        limits: { maxSteps: 30, maxTokens: 200000 },
        retryPolicy: {
          maxAttempts: 1,
          onMustFail: 'abort',
          onShouldFail: 'mark-only',
        },
      },
    }
    expect(platform.identity.id).toMatch(/^__.*__$/)
  })
})

describe('KnowledgeRef union', () => {
  it('narrows by type discriminator', () => {
    const file: KnowledgeRef = {
      type: 'file',
      path: 'a.md',
      description: 'rules',
      format: 'markdown',
      required: true,
    }
    const text: KnowledgeRef = { type: 'text', content: 'glossary', description: 'g' }
    const url: KnowledgeRef = { type: 'url', url: 'https://x', description: 'sop', cache: true }

    expect(file.type).toBe('file')
    expect(text.type).toBe('text')
    expect(url.type).toBe('url')
    if (file.type === 'file') expect(file.path).toBe('a.md')
    if (text.type === 'text') expect(text.content).toBe('glossary')
    if (url.type === 'url') expect(url.url).toBe('https://x')
  })
})

describe('ToolDependency', () => {
  it('accepts disabled flag', () => {
    const t: ToolDependency = { name: 'bash', disabled: true, purpose: 'review-only' }
    expect(t.disabled).toBe(true)
  })

  it('accepts required flag without disabled', () => {
    const t: ToolDependency = { name: 'read', required: true, purpose: 'load source' }
    expect(t.required).toBe(true)
    expect(t.disabled).toBeUndefined()
  })
})

describe('AcceptanceCriterion union (8 variants)', () => {
  it('accepts deliverable-present', () => {
    const c: AcceptanceCriterion = {
      type: 'deliverable-present',
      deliverableId: 'X',
      kind: 'deterministic',
      severity: 'must',
    }
    expect(c.type).toBe('deliverable-present')
  })

  it('accepts tool-was-used with implicit fields', () => {
    const c: AcceptanceCriterion = {
      type: 'tool-was-used',
      toolName: 'read',
      kind: 'deterministic',
      severity: 'must',
      _implicit: true,
      _knowledgePath: 'rules.md',
    }
    if (c.type === 'tool-was-used') {
      expect(c._implicit).toBe(true)
      expect(c._knowledgePath).toBe('rules.md')
    }
  })

  it('accepts tool-not-used', () => {
    const c: AcceptanceCriterion = {
      type: 'tool-not-used',
      toolName: 'write',
      kind: 'deterministic',
    }
    expect(c.type).toBe('tool-not-used')
  })

  it('accepts output-matches with schema or pattern', () => {
    const a: AcceptanceCriterion = {
      type: 'output-matches',
      schema: { type: 'object' },
      kind: 'deterministic',
    }
    const b: AcceptanceCriterion = {
      type: 'output-matches',
      pattern: '```json',
      kind: 'deterministic',
    }
    expect(a.type).toBe('output-matches')
    expect(b.type).toBe('output-matches')
  })

  it('accepts verifier-tool / llm-judge / human-approval', () => {
    const v: AcceptanceCriterion = {
      type: 'verifier-tool',
      toolName: 'check',
      kind: 'deterministic',
    }
    const j: AcceptanceCriterion = {
      type: 'llm-judge',
      judgePrompt: 'Score',
      kind: 'semantic',
      votes: 3,
    }
    const h: AcceptanceCriterion = {
      type: 'human-approval',
      approverRef: 'user',
      kind: 'human',
    }
    expect(v.type).toBe('verifier-tool')
    expect(j.type).toBe('llm-judge')
    expect(h.type).toBe('human-approval')
  })
})

describe('Deliverable + ExtractRule', () => {
  it('accepts schema-only deliverable', () => {
    const d: Deliverable = {
      id: 'x',
      format: 'json',
      schema: { type: 'object' },
      extractFrom: { type: 'json-fenced-block', firstOrLast: 'last' },
      rubric: ['✓ ok', '✗ avoid'],
    }
    expect(d.id).toBe('x')
  })

  it('accepts mustContain-only deliverable', () => {
    const d: Deliverable = {
      id: 'y',
      format: 'markdown',
      mustContain: ['# Title'],
    }
    expect(d.mustContain).toEqual(['# Title'])
  })

  it('ExtractRule covers 4 variants', () => {
    const a: ExtractRule = { type: 'last-message' }
    const b: ExtractRule = { type: 'json-fenced-block' }
    const c: ExtractRule = { type: 'regex-capture', pattern: '(.+)', group: 1 }
    const d: ExtractRule = { type: 'tool-result', toolName: 'foo' }
    expect([a, b, c, d].map((r) => r.type)).toEqual([
      'last-message',
      'json-fenced-block',
      'regex-capture',
      'tool-result',
    ])
  })
})

describe('MissionInput', () => {
  it('declares required input with examples', () => {
    const i: MissionInput = {
      id: 'pr_url',
      description: 'PR URL',
      type: 'text',
      required: true,
      examples: ['https://github.com/x/y/pull/1'],
    }
    expect(i.required).toBe(true)
    expect(i.examples).toHaveLength(1)
  })
})

describe('WorkflowStep DAG fields', () => {
  it('supports inputs/produces/requires', () => {
    const s: WorkflowStep = {
      id: 'analyze',
      description: 'classify findings',
      use: { tools: ['read', 'grep'] },
      inputs: ['context_loaded'],
      produces: 'findings_list',
      requires: ['load_context'],
    }
    expect(s.inputs).toEqual(['context_loaded'])
    expect(s.produces).toBe('findings_list')
  })
})

describe('Outcome priority', () => {
  it('accepts core / auxiliary', () => {
    const a: Outcome = {
      id: 'a',
      description: 'a',
      priority: 'core',
      verifyBy: [
        {
          type: 'deliverable-present',
          deliverableId: 'x',
          kind: 'deterministic',
          severity: 'must',
        },
      ],
    }
    const b: Outcome = {
      id: 'b',
      description: 'b',
      priority: 'auxiliary',
      verifyBy: [
        {
          type: 'deliverable-present',
          deliverableId: 'x',
          kind: 'deterministic',
          severity: 'should',
        },
      ],
    }
    expect(a.priority).toBe('core')
    expect(b.priority).toBe('auxiliary')
  })
})
