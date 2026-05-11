// src/main/agent/agent.test.ts — Schema 2.0 Agent class tests
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import log from 'electron-log'
import { Agent } from './agent'
import { BuiltinToolRegistry } from './builtin-registry'
import { SkillRegistry } from '../skills/registry'
import type { AgentProfile } from '@shared/types/agent'
import type { ToolDefinition } from '../tools/types'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    riskLevel: 'LOW',
    execute: async () => ({ output: `${name} result` }),
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

const PLATFORM_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: '__chat__',
  name: 'Talor',
  description: 'Platform default',
  version: '0.2.0',
  agentPrompt: '# Identity\nYou are Talor, a helpful AI assistant.',
}

const BUSINESS_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: 'sales_001',
  name: '销售分析师',
  description: '汇总销售数据',
  version: '1.0.0',
  agentPrompt:
    '# Identity\nYou are a sales analyst.\n\n## Responsibilities\n- Generate weekly sales summary.',
  tools: ['bash'],
}

describe('Agent (schema 2.0)', () => {
  it('platform Agent: no tools restriction → all tools visible', () => {
    const agent = new Agent({
      profile: PLATFORM_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(agent.id).toBe('__chat__')
    expect(agent.source).toBeNull()

    const tools = agent.toolRegistry.getToolNames()
    expect(tools.length).toBeGreaterThanOrEqual(7)
    expect(tools).toContain('bash')
    expect(tools).toContain('write')
  })

  it('business Agent: tools whitelist filters to declared tools', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: '/home/user/.talor/agents/sales',
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(agent.id).toBe('sales_001')
    expect(agent.skillsDir).toBe('/home/user/.talor/agents/sales/skills')
    expect(agent.knowledgeDir).toBe('/home/user/.talor/agents/sales/knowledge')

    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toContain('bash')
    expect(tools).toContain('read') // ALWAYS_AVAILABLE
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('edit')
  })

  it('profile identity getters work', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.name).toBe('销售分析师')
    expect(agent.profile.description).toBe('汇总销售数据')
  })
})

describe('Agent search_tool injection', () => {
  const mcpWithTools = {
    listRegisteredTools: () => [
      { name: 'srv_a', description: '', parameters: {}, provider: 'srv' },
    ],
    execute: async () => ({ output: 'noop' }),
  }
  const mcpEmpty = {
    listRegisteredTools: () => [],
    execute: async () => ({ output: 'noop' }),
  }

  it('mcpRegistry with tools → search_tool visible', () => {
    const agent = new Agent({
      profile: PLATFORM_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: mcpWithTools,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    const builtinNames = agent.toolRegistry.listBuiltinTools().map((t) => t.name)
    expect(builtinNames).toContain('search_tool')
  })

  it('null mcpRegistry → no search_tool', () => {
    const agent = new Agent({
      profile: PLATFORM_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.toolRegistry.listBuiltinTools().map((t) => t.name)).not.toContain('search_tool')
  })

  it('empty mcpRegistry → no search_tool', () => {
    const agent = new Agent({
      profile: PLATFORM_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: mcpEmpty,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.toolRegistry.listBuiltinTools().map((t) => t.name)).not.toContain('search_tool')
  })
})

describe('Agent delegationRuntime + allowedAgentIds (AC-031, AC-032)', () => {
  function makeStubRuntime(agentList: string[] = []) {
    return {
      agentManager: {
        getAgent: (id: string) =>
          agentList.includes(id) ? { id, profile: { id, name: id, description: '' } } : null,
        listBusinessAgentIds: () => agentList,
      },
      runReactLoop: async () => {},
      sessionRepo: {} as unknown,
      pipeline: {} as unknown,
      config: {
        maxConcurrencyPerSession: 10,
        queueTimeoutMs: 5_000,
        executionTimeoutMs: 10_000,
      },
      providerContextProvider: () => ({ model: {}, provider: {}, providerConfig: {} }),
    } as unknown as ConstructorParameters<typeof Agent>[0]['delegationRuntime']
  }

  it('AC-031: __chat__ with allowAny → allowedAgentIds === null', () => {
    const profile: AgentProfile = {
      ...PLATFORM_PROFILE,
      subagents: { allowAny: true },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
      delegationRuntime: makeStubRuntime(['a', 'b']),
    })
    expect(agent.delegationRuntime).not.toBeNull()
    expect(agent.allowedAgentIds).toBeNull()
  })

  it('AC-032: business agent with no collaboration → allowedAgentIds === []', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
      delegationRuntime: makeStubRuntime([]),
    })
    expect(agent.delegationRuntime).not.toBeNull()
    expect(agent.allowedAgentIds).toEqual([])
  })

  it('subagents.ids=[A] → allowedAgentIds === [A]', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      subagents: { ids: [{ id: 'sub_a', required: true }] },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
      delegationRuntime: makeStubRuntime(['sub_a']),
    })
    expect(agent.allowedAgentIds).toEqual(['sub_a'])
  })

  it('no delegationRuntime → all delegation fields null', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.delegationRuntime).toBeNull()
    expect(agent.allowedAgentIds).toBeNull()
  })

  it('both ids + allowAny declared → allowAny wins (warn)', () => {
    const profile: AgentProfile = {
      ...PLATFORM_PROFILE,
      subagents: {
        ids: [{ id: 'a', required: true }],
        allowAny: true,
      },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
      delegationRuntime: makeStubRuntime(['a', 'b']),
    })
    expect(agent.allowedAgentIds).toBeNull()
    expect(log.warn).toHaveBeenCalled()
  })
})
