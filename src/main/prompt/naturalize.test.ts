// src/main/prompt/naturalize.test.ts
import { describe, it, expect } from 'vitest'
import { naturalize, joinNaturalize, schemaToBullets } from './naturalize'
import type { AcceptanceCriterion } from '@shared/types/agent'

describe('naturalize', () => {
  it('AC-050: tool-not-used', () => {
    const c: AcceptanceCriterion = {
      type: 'tool-not-used',
      toolName: 'write',
      kind: 'deterministic',
    }
    expect(naturalize(c)).toBe('You did NOT call the "write" tool')
  })

  it('deliverable-present (regular)', () => {
    expect(
      naturalize({
        type: 'deliverable-present',
        deliverableId: 'review_report',
        kind: 'deterministic',
      }),
    ).toBe('A "review_report" block is present in your final output')
  })

  it('tool-was-used (regular)', () => {
    expect(
      naturalize({
        type: 'tool-was-used',
        toolName: 'read',
        kind: 'deterministic',
      }),
    ).toBe('You called the "read" tool at least once')
  })

  it('tool-was-used (implicit) renders knowledge path', () => {
    expect(
      naturalize({
        type: 'tool-was-used',
        toolName: 'read',
        kind: 'deterministic',
        _implicit: true,
        _knowledgePath: 'rules.md',
      }),
    ).toBe('You read "rules.md" at least once')
  })

  it('tool-not-failed', () => {
    expect(naturalize({ type: 'tool-not-failed', toolName: 'bash', kind: 'deterministic' })).toBe(
      'Your "bash" calls all succeeded',
    )
  })

  it('output-matches with schema', () => {
    expect(
      naturalize({
        type: 'output-matches',
        schema: { type: 'object' },
        kind: 'deterministic',
      }),
    ).toBe('Your output JSON matches the required schema')
  })

  it('output-matches with pattern', () => {
    expect(naturalize({ type: 'output-matches', pattern: 'hello', kind: 'deterministic' })).toBe(
      'Your output contains the pattern "hello"',
    )
  })

  it('verifier-tool', () => {
    expect(naturalize({ type: 'verifier-tool', toolName: 'check', kind: 'deterministic' })).toBe(
      'The "check" verifier passes',
    )
  })

  it('llm-judge', () => {
    expect(naturalize({ type: 'llm-judge', judgePrompt: 'X', kind: 'semantic', votes: 3 })).toBe(
      'An independent reviewer agrees the output is acceptable',
    )
  })

  it('human-approval', () => {
    expect(naturalize({ type: 'human-approval', approverRef: 'user', kind: 'human' })).toBe(
      'A human reviewer (user) approves',
    )
  })
})

describe('joinNaturalize', () => {
  it('joins multiple criteria with AND', () => {
    const c1: AcceptanceCriterion = {
      type: 'tool-was-used',
      toolName: 'read',
      kind: 'deterministic',
    }
    const c2: AcceptanceCriterion = {
      type: 'tool-not-used',
      toolName: 'write',
      kind: 'deterministic',
    }
    expect(joinNaturalize([c1, c2])).toBe(
      'You called the "read" tool at least once AND You did NOT call the "write" tool',
    )
  })
})

describe('schemaToBullets', () => {
  it('renders simple object schema as bullet list', () => {
    const schema = {
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string', description: 'user name' },
        age: { type: 'integer' },
        avatar: { type: 'string', description: 'optional URL' },
      },
    }
    const out = schemaToBullets(schema)
    expect(out).toContain('- name (string, REQUIRED)')
    expect(out).toContain('user name')
    expect(out).toContain('- age (integer, REQUIRED)')
    expect(out).toContain('- avatar (string)')
  })
})
