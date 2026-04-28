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
  makeTool('read'), makeTool('write'), makeTool('edit'),
  makeTool('bash'), makeTool('glob'), makeTool('grep'),
  makeTool('ls'), makeTool('skill'),
])

const BUSINESS_PROFILE: AgentProfile = {
  id: 'sales-001',
  name: '销售分析师',
  description: '汇总销售',
  version: '1.0.0',
  role: { capabilities: ['分析'], outputFormat: 'md' },
  knowledge: { files: [] },
  dependencies: {
    tools: [{ name: 'bash', required: true }],
    mcpServers: [], skills: [], cli: [],
  },
}

describe('AgentManager', () => {
  let manager: AgentManager

  beforeEach(() => {
    manager = new AgentManager()
    manager.init({
      builtinRegistry,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })
  })

  it('init creates platform agents', () => {
    expect(manager.isInitialized).toBe(true)
    expect(manager.getAgent('__chat__')).not.toBeNull()
    expect(manager.getAgent('__crystallizer__')).not.toBeNull()
  })

  it('getChatAgent returns __chat__ agent', () => {
    const chat = manager.getChatAgent()
    expect(chat.id).toBe('__chat__')
    expect(chat.name).toBe('Talor')
  })

  it('platform __chat__ has all tools (empty whitelist)', () => {
    const chat = manager.getAgent('__chat__')!
    const tools = chat.toolRegistry.getToolNames()
    expect(tools).toHaveLength(8)
    expect(tools).toContain('bash')
    expect(tools).toContain('write')
  })

  it('platform __crystallizer__ has limited tools', () => {
    const cryst = manager.getAgent('__crystallizer__')!
    const tools = cryst.toolRegistry.getToolNames()
    expect(tools).toContain('read')   // declared + ALWAYS_AVAILABLE
    expect(tools).toContain('skill')  // ALWAYS_AVAILABLE
    expect(tools).not.toContain('bash')
    expect(tools).not.toContain('write')
  })

  it('getAgent returns null for unknown id', () => {
    expect(manager.getAgent('nonexistent')).toBeNull()
  })

  it('registerBusinessAgent creates and stores agent', () => {
    const agent = manager.registerBusinessAgent('sales-001', {
      profile: BUSINESS_PROFILE,
      source: '/tmp/agents/sales',
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(agent.id).toBe('sales-001')
    expect(manager.getAgent('sales-001')).toBe(agent)
    expect(manager.listBusinessAgentIds()).toContain('sales-001')
  })

  it('registerBusinessAgent replaces existing agent', () => {
    manager.registerBusinessAgent('sales-001', {
      profile: BUSINESS_PROFILE,
      source: '/tmp/agents/sales',
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    const agent2 = manager.registerBusinessAgent('sales-001', {
      profile: { ...BUSINESS_PROFILE, description: 'updated' },
      source: '/tmp/agents/sales',
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(manager.getAgent('sales-001')).toBe(agent2)
    expect(agent2.profile.description).toBe('updated')
  })

  it('unregisterBusinessAgent removes agent', () => {
    manager.registerBusinessAgent('sales-001', {
      profile: BUSINESS_PROFILE,
      source: null,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    expect(manager.unregisterBusinessAgent('sales-001')).toBe(true)
    expect(manager.getAgent('sales-001')).toBeNull()
    expect(manager.listBusinessAgentIds()).not.toContain('sales-001')
  })

  it('unregisterBusinessAgent returns false for unknown', () => {
    expect(manager.unregisterBusinessAgent('nope')).toBe(false)
  })

  it('getChatAgent throws if not initialized', () => {
    const fresh = new AgentManager()
    expect(() => fresh.getChatAgent()).toThrow('AgentManager not initialized')
  })

  it('business agent tools are filtered by whitelist', () => {
    const agent = manager.registerBusinessAgent('sales-001', {
      profile: BUSINESS_PROFILE,
      source: null,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    const tools = agent.toolRegistry.getToolNames()
    expect(tools).toContain('bash')
    expect(tools).toContain('read')    // ALWAYS_AVAILABLE
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('edit')
  })
})
