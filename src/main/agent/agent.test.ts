import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

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
  id: '__chat__',
  name: 'Talor',
  description: 'Platform default agent',
  version: '0.1.0',
  role: { capabilities: [], outputFormat: '' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

const BUSINESS_PROFILE: AgentProfile = {
  id: 'sales-001',
  name: '销售分析师',
  description: '汇总销售数据',
  version: '1.0.0',
  role: {
    capabilities: ['从飞书表格获取销售数据'],
    outputFormat: 'Markdown',
  },
  knowledge: { files: [] },
  dependencies: {
    tools: [{ name: 'bash', required: true }],
    mcpServers: [],
    skills: [],
    cli: [],
  },
}

describe('Agent', () => {
  it('platform Agent: empty allowedTools → all tools visible', () => {
    const agent = new Agent({
      profile: PLATFORM_PROFILE,
      source: null,
      builtinRegistry,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(agent.id).toBe('__chat__')
    expect(agent.source).toBeNull()
    expect(agent.skillsDir).toBeNull()
    expect(agent.knowledgeDir).toBeNull()

    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toHaveLength(8)
    expect(tools).toContain('bash')
    expect(tools).toContain('write')
  })

  it('business Agent: whitelist filters tools', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: '/home/user/.talor/agents/sales',
      builtinRegistry,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(agent.id).toBe('sales-001')
    expect(agent.source).toBe('/home/user/.talor/agents/sales')
    expect(agent.skillsDir).toBe('/home/user/.talor/agents/sales/skills')
    expect(agent.knowledgeDir).toBe('/home/user/.talor/agents/sales/knowledge')

    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toContain('bash')
    expect(tools).toContain('read') // ALWAYS_AVAILABLE
    expect(tools).toContain('skill') // ALWAYS_AVAILABLE
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('edit')
  })

  it('profile and name are accessible via getters', () => {
    const agent = new Agent({
      profile: BUSINESS_PROFILE,
      source: null,
      builtinRegistry,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(agent.name).toBe('销售分析师')
    expect(agent.profile.description).toBe('汇总销售数据')
  })

  it('toolRegistry is constructed from profile dependencies', () => {
    const multiToolProfile: AgentProfile = {
      ...BUSINESS_PROFILE,
      dependencies: {
        ...BUSINESS_PROFILE.dependencies,
        tools: [
          { name: 'bash', required: true },
          { name: 'write', required: false },
        ],
      },
    }
    const agent = new Agent({
      profile: multiToolProfile,
      source: null,
      builtinRegistry,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toContain('bash')
    expect(tools).toContain('write')
    expect(tools).toContain('read') // ALWAYS_AVAILABLE
    expect(tools).not.toContain('edit')
  })

  describe('TASK-3: search_tool injection', () => {
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

    it('AC-3-1: agent has mcpRegistry with tools → search_tool visible in builtin set', () => {
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

    it('does not inject search_tool when mcpRegistry is null', () => {
      const agent = new Agent({
        profile: PLATFORM_PROFILE,
        source: null,
        builtinRegistry,
        mcpRegistry: null,
        skillRegistry: SkillRegistry.fromDir(null),
      })
      const builtinNames = agent.toolRegistry.listBuiltinTools().map((t) => t.name)
      expect(builtinNames).not.toContain('search_tool')
    })

    it('hides search_tool when mcpRegistry has zero tools (lazy/disconnected)', () => {
      const agent = new Agent({
        profile: PLATFORM_PROFILE,
        source: null,
        builtinRegistry,
        mcpRegistry: mcpEmpty,
        skillRegistry: SkillRegistry.fromDir(null),
      })
      const builtinNames = agent.toolRegistry.listBuiltinTools().map((t) => t.name)
      expect(builtinNames).not.toContain('search_tool')
    })

    it('AC-3-2: search_tool execute reads from injected mcpRegistry', async () => {
      const agent = new Agent({
        profile: PLATFORM_PROFILE,
        source: null,
        builtinRegistry,
        mcpRegistry: mcpWithTools,
        skillRegistry: SkillRegistry.fromDir(null),
      })
      const result = await agent.toolRegistry.execute(
        'search_tool',
        {},
        { sessionId: 's', workspace: '' },
      )
      expect(result.output as string).toContain('Loaded 1 MCP tools')
      expect(result.output as string).toContain('srv')
    })
  })
})
