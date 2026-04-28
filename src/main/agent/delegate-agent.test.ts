import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createDelegateAgentTool } from './delegate-agent'
import { AgentManager } from './agent-manager'
import { BuiltinToolRegistry } from './builtin-registry'
import { SkillRegistry } from '../skills/registry'
import type { ToolDefinition } from '../tools/types'
import type { AgentProfile } from '@shared/types/agent'

function makeTool(name: string): ToolDefinition {
  return { name, description: name, parameters: {}, execute: async () => ({ output: name }) }
}

const builtinRegistry = new BuiltinToolRegistry([
  makeTool('read'), makeTool('write'), makeTool('edit'),
  makeTool('bash'), makeTool('glob'), makeTool('grep'),
  makeTool('ls'), makeTool('skill'),
])

const TRANSLATOR_PROFILE: AgentProfile = {
  id: 'translator-001', name: '翻译助手', description: '翻译', version: '1.0.0',
  role: { capabilities: ['翻译'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

describe('delegate_agent Tool', () => {
  let manager: AgentManager
  let tool: ToolDefinition

  beforeAll(() => {
    manager = new AgentManager()
    manager.init({
      builtinRegistry,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    manager.registerBusinessAgent('translator-001', {
      profile: TRANSLATOR_PROFILE,
      source: null,
      mcpSource: null,
      skillRegistry: SkillRegistry.fromDir(null),
    })

    tool = createDelegateAgentTool(manager)
  })

  it('AC-D4-01: delegates to existing agent', async () => {
    const result = await tool.execute(
      { agent_id: 'translator-001', instruction: '翻译成英文', context: '销售报告摘要' },
      { sessionId: 's1', workspace: '' },
    )

    const output = JSON.parse(result.output as string)
    expect(output.delegated_to).toBe('translator-001')
    expect(output.agent_name).toBe('翻译助手')
    expect(output.instruction).toContain('销售报告摘要')
    expect(output.instruction).toContain('翻译成英文')
  })

  it('returns error for unknown agent', async () => {
    const result = await tool.execute(
      { agent_id: 'nonexistent', instruction: 'test' },
      { sessionId: 's1', workspace: '' },
    )
    expect(result.output).toContain('Agent not found')
  })

  it('handles instruction without context', async () => {
    const result = await tool.execute(
      { agent_id: 'translator-001', instruction: '翻译 Hello' },
      { sessionId: 's1', workspace: '' },
    )
    const output = JSON.parse(result.output as string)
    expect(output.instruction).toBe('翻译 Hello')
  })

  it('has correct tool metadata', () => {
    expect(tool.name).toBe('delegate_agent')
    expect(tool.riskLevel).toBe('LOW')
    expect(tool.parameters.required).toContain('agent_id')
    expect(tool.parameters.required).toContain('instruction')
  })
})
