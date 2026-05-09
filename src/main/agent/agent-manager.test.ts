// src/main/agent/agent-manager.test.ts — Schema 1.0 AgentManager tests
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentManager } from './agent-manager'
import { BuiltinToolRegistry } from './builtin-registry'
import { SkillRegistry } from '../skills/registry'
import type { ToolDefinition } from '../tools/types'
import type { AgentProfile } from '@shared/types/agent'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ output: name }),
  }
}

const builtinRegistry = new BuiltinToolRegistry([
  makeTool('read'),
  makeTool('write'),
  makeTool('edit'),
  makeTool('bash'),
  makeTool('glob'),
  makeTool('grep'),
  makeTool('ls'),
  makeTool('skill'),
])

const BUSINESS_PROFILE: AgentProfile = {
  schemaVersion: '1.0',
  identity: { id: 'sales_001', name: '销售分析师', description: '汇总销售', version: '1.0.0' },
  mission: {
    objective: 'Generate sales summary',
    outcomes: [
      {
        id: 'sales_done',
        description: 'sales summary done',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 's',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  },
  method: { capabilities: ['Generate sales summary'], tools: [{ name: 'bash', required: true }] },
  delivery: {
    deliverables: [{ id: 's', format: 'markdown', mustContain: ['# S'] }],
  },
  execution: {
    limits: { maxSteps: 10, maxTokens: 10000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

describe('AgentManager (schema 1.0)', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = new AgentManager()
    manager.init({
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    } as unknown as Parameters<AgentManager['init']>[0])
  })

  it('init creates platform agents', () => {
    expect(manager.isInitialized).toBe(true)
    expect(manager.getAgent('__chat__')).not.toBeNull()
    expect(manager.getAgent('__crystallizer__')).not.toBeNull()
  })

  it('AC-046: __chat__ profile mission.outcomes/delivery is empty (platform exception)', () => {
    const chat = manager.getAgent('__chat__')!
    expect(chat.profile.mission.outcomes).toEqual([])
    expect(chat.profile.delivery.deliverables).toEqual([])
  })

  it('AC-021: __chat__ has correct identity', () => {
    const chat = manager.getChatAgent()
    expect(chat.id).toBe('__chat__')
    expect(chat.name).toBe('Talor')
    expect(chat.profile.schemaVersion).toBe('1.0')
  })

  it('platform __chat__ has all tools (empty whitelist)', () => {
    const chat = manager.getAgent('__chat__')!
    const tools = chat.toolRegistry.getToolNames()
    expect(tools.length).toBeGreaterThanOrEqual(8)
    expect(tools).toContain('bash')
    expect(tools).toContain('write')
  })

  it('platform __crystallizer__ has limited tools (locked to read)', () => {
    const cryst = manager.getAgent('__crystallizer__')!
    const tools = cryst.toolRegistry.getToolNames()
    expect(tools).toContain('read')
    expect(tools).not.toContain('bash')
    expect(tools).not.toContain('write')
  })

  it('Crystallizer profile has full schema 1.0 structure', () => {
    const cryst = manager.getAgent('__crystallizer__')!
    expect(cryst.profile.mission.outcomes.length).toBeGreaterThanOrEqual(1)
    expect(cryst.profile.delivery.deliverables.length).toBeGreaterThanOrEqual(1)
    expect(cryst.profile.delivery.deliverables[0].id).toBe('agent_profile_draft')
    expect(cryst.profile.delivery.deliverables[0].rubric).toBeDefined()
  })

  it('getAgent returns null for unknown id', () => {
    expect(manager.getAgent('nonexistent')).toBeNull()
  })

  it('registerBusinessAgent creates and stores agent', () => {
    const agent = manager.registerBusinessAgent('sales_001', {
      profile: BUSINESS_PROFILE,
      source: '/tmp/agents/sales',
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.id).toBe('sales_001')
    expect(manager.getAgent('sales_001')).toBe(agent)
    expect(manager.listBusinessAgentIds()).toContain('sales_001')
  })

  it('unregisterBusinessAgent removes agent', () => {
    manager.registerBusinessAgent('sales_001', {
      profile: BUSINESS_PROFILE,
      source: null,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(manager.unregisterBusinessAgent('sales_001')).toBe(true)
    expect(manager.getAgent('sales_001')).toBeNull()
  })

  it('getChatAgent throws if not initialized', () => {
    const fresh = new AgentManager()
    expect(() => fresh.getChatAgent()).toThrow('AgentManager not initialized')
  })

  it('business agent tools are filtered by whitelist', () => {
    const agent = manager.registerBusinessAgent('sales_001', {
      profile: BUSINESS_PROFILE,
      source: null,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toContain('bash')
    expect(tools).toContain('read')
    expect(tools).not.toContain('write')
  })
})

describe('AgentManager platform delegation (AC-031, AC-047)', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = new AgentManager()
    const stubRuntime = {
      agentManager: {
        getAgent: (id: string) => manager.getAgent(id),
        listBusinessAgentIds: () => manager.listBusinessAgentIds(),
      },
      runReactLoop: async () => {},
      sessionRepo: {} as unknown,
      pipeline: {} as unknown,
      config: { maxConcurrencyPerSession: 10, queueTimeoutMs: 5_000, executionTimeoutMs: 10_000 },
      providerContextProvider: () => ({ model: {}, provider: {}, providerConfig: {} }),
    } as unknown as Parameters<AgentManager['init']>[0]['delegationRuntime']
    manager.init({
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
      delegationRuntime: stubRuntime,
    } as unknown as Parameters<AgentManager['init']>[0])
  })

  it('AC-031/AC-047: __chat__ exposes delegate_agent + allowedAgentIds === null', () => {
    const chat = manager.getAgent('__chat__')!
    expect(chat.toolRegistry.getToolNames()).toContain('delegate_agent')
    expect(chat.allowedAgentIds).toBeNull()
  })

  it('__crystallizer__ has delegate_agent tool but scope is empty []', () => {
    const cryst = manager.getAgent('__crystallizer__')!
    expect(cryst.toolRegistry.getToolNames()).toContain('delegate_agent')
    expect(cryst.allowedAgentIds).toEqual([])
  })
})
