// src/main/agent/agent.test.ts — Schema 1.0 Agent class tests
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { Agent, buildResolvedAcceptance } from './agent'
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
  schemaVersion: '1.0',
  identity: { id: '__chat__', name: 'Talor', description: 'Platform default', version: '0.2.0' },
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
  identity: {
    id: 'sales_001',
    name: '销售分析师',
    description: '汇总销售数据',
    version: '1.0.0',
  },
  mission: {
    objective: 'Generate weekly sales summary',
    outcomes: [
      {
        id: 'sales_summary_done',
        description: 'User receives sales summary report',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'summary',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  },
  method: {
    capabilities: ['Generate sales summary report from data'],
    tools: [{ name: 'bash', required: true }],
  },
  delivery: {
    deliverables: [{ id: 'summary', format: 'markdown', mustContain: ['# Summary'] }],
  },
  execution: {
    limits: { maxSteps: 20, maxTokens: 100000 },
    retryPolicy: { maxAttempts: 2, onMustFail: 'retry-then-mark', onShouldFail: 'mark-only' },
  },
}

describe('Agent (schema 1.0)', () => {
  it('platform Agent: empty allowedTools → all tools visible', () => {
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
    expect(tools.length).toBeGreaterThanOrEqual(8)
    expect(tools).toContain('bash')
    expect(tools).toContain('write')
  })

  it('business Agent: whitelist filters tools', () => {
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

  it('AC-030: tools[].disabled physically filters from API list', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      method: {
        ...BUSINESS_PROFILE.method,
        tools: [
          { name: 'read', required: true },
          { name: 'bash', disabled: true },
        ],
      },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toContain('read')
    expect(tools).not.toContain('bash')
  })

  it('profile.identity getters work', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.name).toBe('销售分析师')
    expect(agent.profile.identity.description).toBe('汇总销售数据')
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
          agentList.includes(id)
            ? { id, profile: { identity: { id, name: id, description: '' } } }
            : null,
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

  it('AC-031: __chat__ with allowAnyBusinessSubagent → allowedAgentIds === null', () => {
    const profile: AgentProfile = {
      ...PLATFORM_PROFILE,
      method: {
        ...PLATFORM_PROFILE.method,
        collaboration: { allowAnyBusinessSubagent: true },
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

  it('subagents=[A] → allowedAgentIds === [A]', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      method: {
        ...BUSINESS_PROFILE.method,
        collaboration: { subagents: [{ id: 'sub_a', required: true }] },
      },
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

  it('both subagents + allowAny declared → allowAny wins (warn)', () => {
    const profile: AgentProfile = {
      ...PLATFORM_PROFILE,
      method: {
        ...PLATFORM_PROFILE.method,
        collaboration: {
          subagents: [{ id: 'a', required: true }],
          allowAnyBusinessSubagent: true,
        },
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
  })
})

describe('Agent resolvedAcceptance (RULE 15 implicit injection)', () => {
  it('AC-022: knowledge.required=true → tool-was-used implicit criterion', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      method: {
        ...BUSINESS_PROFILE.method,
        knowledge: [
          {
            type: 'file',
            path: 'rules.md',
            description: 'rules',
            format: 'markdown',
            required: true,
          },
        ],
      },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.resolvedAcceptance.length).toBe(2) // 1 from profile + 1 implicit
    const implicit = agent.resolvedAcceptance.find((c) => '_implicit' in c && c._implicit)
    expect(implicit).toBeDefined()
    expect(implicit!.type).toBe('tool-was-used')
    if (implicit && implicit.type === 'tool-was-used') {
      expect(implicit._knowledgePath).toBe('rules.md')
      expect(implicit.severity).toBe('must')
      expect(implicit.kind).toBe('deterministic')
    }
  })

  it('AC-033: 2 required knowledge files → 2 implicit criteria', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      method: {
        ...BUSINESS_PROFILE.method,
        knowledge: [
          { type: 'file', path: 'a.md', description: 'a', required: true },
          { type: 'file', path: 'b.md', description: 'b', required: true },
        ],
      },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    const implicits = agent.resolvedAcceptance.filter((c) => '_implicit' in c && c._implicit)
    expect(implicits).toHaveLength(2)
    const paths = implicits.map((c) =>
      'type' in c && c.type === 'tool-was-used' ? c._knowledgePath : null,
    )
    expect(paths.sort()).toEqual(['a.md', 'b.md'])
  })

  it('knowledge.required=false → no implicit injection', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      method: {
        ...BUSINESS_PROFILE.method,
        knowledge: [{ type: 'file', path: 'a.md', description: 'a' }],
      },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    const implicits = agent.resolvedAcceptance.filter((c) => '_implicit' in c && c._implicit)
    expect(implicits).toHaveLength(0)
  })

  it('text/url knowledge does not trigger implicit', () => {
    const profile: AgentProfile = {
      ...BUSINESS_PROFILE,
      method: {
        ...BUSINESS_PROFILE.method,
        knowledge: [
          { type: 'text', content: 'g', description: 'glossary' },
          { type: 'url', url: 'https://x', description: 'sop' },
        ],
      },
    }
    const agent = new Agent({
      profile,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    const implicits = agent.resolvedAcceptance.filter((c) => '_implicit' in c && c._implicit)
    expect(implicits).toHaveLength(0)
  })

  it('platform agent with empty acceptance + no required knowledge → resolvedAcceptance is []', () => {
    const agent = new Agent({
      profile: PLATFORM_PROFILE,
      source: null,
      builtinRegistry,
      mcpRegistry: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
    expect(agent.resolvedAcceptance).toEqual([])
  })

  it('buildResolvedAcceptance helper export', () => {
    const acc = buildResolvedAcceptance(BUSINESS_PROFILE)
    expect(acc).toHaveLength(1)
    expect(acc[0].type).toBe('deliverable-present')
  })
})
