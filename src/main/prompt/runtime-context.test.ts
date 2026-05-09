// src/main/prompt/runtime-context.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { Agent } from '../agent/agent'
import { BuiltinToolRegistry } from '../agent/builtin-registry'
import { SkillRegistry } from '../skills/registry'
import { buildRuntimeContext } from './runtime-context'
import type { AgentProfile } from '@shared/types/agent'
import type { ToolDefinition } from '../tools/types'

const builtin = new BuiltinToolRegistry([
  {
    name: 'read',
    description: 'r',
    parameters: {},
    execute: async () => ({ output: '' }),
  } as ToolDefinition,
])

const PLATFORM_PROFILE: AgentProfile = {
  schemaVersion: '1.0',
  identity: { id: '__chat__', name: 'Talor', description: 'D', version: '0.2.0' },
  mission: { objective: 'help', outcomes: [] },
  method: { capabilities: ['general'] },
  delivery: { deliverables: [] },
  execution: {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

const BUSINESS_PROFILE: AgentProfile = {
  schemaVersion: '1.0',
  identity: { id: 'reviewer', name: 'Reviewer', description: 'R', version: '1.0.0' },
  mission: {
    objective: 'review',
    outcomes: [
      {
        id: 'core_done',
        description: 'review report ready',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'r',
            kind: 'deterministic',
            severity: 'must',
          },
          { type: 'tool-not-used', toolName: 'write', kind: 'deterministic', severity: 'must' },
          { type: 'verifier-tool', toolName: 'check', kind: 'deterministic', severity: 'should' },
        ],
      },
      {
        id: 'aux',
        description: 'good vibes',
        priority: 'auxiliary',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'r',
            kind: 'deterministic',
            severity: 'should',
          },
        ],
      },
    ],
    inputs: [
      {
        id: 'pr_url',
        description: 'PR URL',
        type: 'text',
        required: true,
        examples: ['https://x/pr/1'],
      },
    ],
  },
  method: {
    capabilities: ['Review'],
    knowledge: [
      { type: 'file', path: 'a.md', description: 'rules', required: true },
      { type: 'text', content: 'glossary inline', description: 'glossary' },
    ],
    tools: [{ name: 'read', required: true }],
  },
  delivery: {
    deliverables: [
      {
        id: 'r',
        format: 'json',
        schema: { type: 'object' },
        rubric: ['✓ cite line', '✗ no nits with blockers'],
      },
    ],
  },
  execution: {
    limits: { maxSteps: 30, maxTokens: 100 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

function makeAgent(profile: AgentProfile, runtime: 'with' | 'without' = 'without'): Agent {
  type AgentCtorOpts = ConstructorParameters<typeof Agent>[0]
  const stub = {
    agentManager: {
      getAgent: () => null,
      listBusinessAgentIds: () => [],
    },
    runReactLoop: async () => {},
    sessionRepo: {} as unknown,
    pipeline: {} as unknown,
    config: { maxConcurrencyPerSession: 10, queueTimeoutMs: 5_000, executionTimeoutMs: 10_000 },
    providerContextProvider: () => ({ model: {}, provider: {}, providerConfig: {} }),
  } as unknown as AgentCtorOpts['delegationRuntime']
  return new Agent({
    profile,
    source: null,
    builtinRegistry: builtin,
    mcpRegistry: null,
    skillRegistry: SkillRegistry.fromDir(null),
    delegationRuntime: runtime === 'with' ? stub : undefined,
  })
}

describe('buildRuntimeContext', () => {
  it('AC-046: __chat__ has empty mission outcomes', () => {
    const agent = makeAgent(PLATFORM_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasMissionOutcomes).toBe(false)
    expect(ctx.coreOutcomes).toHaveLength(0)
    expect(ctx.auxOutcomes).toHaveLength(0)
  })

  it('AC-040: business agent splits core/aux outcomes', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasCoreOutcomes).toBe(true)
    expect(ctx.hasAuxOutcomes).toBe(true)
    expect(ctx.coreOutcomes[0].id).toBe('core_done')
    expect(ctx.auxOutcomes[0].id).toBe('aux')
  })

  it('AC-049: hasInputs reflects mission.inputs presence', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasInputs).toBe(true)
    expect(ctx.inputs[0].id).toBe('pr_url')
  })

  it('AC-049 negative: platform agent has no inputs', () => {
    const agent = makeAgent(PLATFORM_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasInputs).toBe(false)
  })

  it('AC-042: acceptance split must/should', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    // v8 source = outcomes.flatMap(verifyBy) + implicit:
    //   outcomes[0].verifyBy: 2 must (deliverable-present + tool-not-used) + 1 should (verifier-tool)
    //   outcomes[1].verifyBy: 1 should (deliverable-present)
    //   implicit: 1 must (knowledge.required → tool-was-used read)
    // → 3 must, 2 should
    expect(ctx.acceptanceMust).toHaveLength(3)
    expect(ctx.acceptanceShould).toHaveLength(2)
  })

  it('AC-022: implicit acceptance appears in must (knowledge.required=true)', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    // resolvedAcceptance has 4 items: 3 from profile + 1 implicit
    const implicit = ctx.acceptanceMust.find((c) => '_implicit' in c && c._implicit)
    expect(implicit).toBeDefined()
  })

  it('AC-043: hasQualityPledges + deliverablesWithRubric', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasQualityPledges).toBe(true)
    expect(ctx.deliverablesWithRubric).toHaveLength(1)
  })

  it('AC-047: __chat__ with delegationRuntime → hasCollaborators=true', () => {
    const agent = makeAgent(
      {
        ...PLATFORM_PROFILE,
        method: { ...PLATFORM_PROFILE.method, collaboration: { allowAnyBusinessSubagent: true } },
      },
      'with',
    )
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasCollaborators).toBe(true)
  })

  it('AC-048: business agent with no delegation → hasCollaborators=false', () => {
    const agent = makeAgent(BUSINESS_PROFILE) // no delegationRuntime
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.hasCollaborators).toBe(false)
  })

  it('isFirstIteration true at iteration 0', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.isFirstIteration).toBe(true)
  })

  it('isFirstIteration false at iteration 1', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 1, tokensUsed: 0 })
    expect(ctx.isFirstIteration).toBe(false)
  })

  it('showDeliverableReminder triggers when tokens > 0.7 * maxTokens', () => {
    const agent = makeAgent(BUSINESS_PROFILE) // maxTokens=100
    const ctx = buildRuntimeContext(agent, { iterationNumber: 5, tokensUsed: 80 })
    expect(ctx.showDeliverableReminder).toBe(true)
  })

  it('showDeliverableReminder false when tokens low', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 5, tokensUsed: 30 })
    expect(ctx.showDeliverableReminder).toBe(false)
  })

  it('enriched knowledge has isFile/isText flags', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.method.knowledge).toBeDefined()
    expect(ctx.method.knowledge![0].isFile).toBe(true)
    expect(ctx.method.knowledge![1].isText).toBe(true)
  })

  it('requiredKnowledgePaths', () => {
    const agent = makeAgent(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.requiredKnowledgePaths).toBe('a.md')
  })

  it('platform __chat__ critical role constraint mentions delegate', () => {
    const agent = makeAgent(PLATFORM_PROFILE)
    const ctx = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
    expect(ctx.criticalRoleConstraints.length).toBeGreaterThan(0)
    expect(ctx.criticalRoleConstraints.join(' ')).toMatch(/delegate/i)
  })
})
