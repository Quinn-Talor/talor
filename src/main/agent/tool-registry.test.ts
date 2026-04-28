import { describe, it, expect } from 'vitest'
import { BuiltinToolRegistry } from './builtin-registry'
import { ToolRegistry, ALWAYS_AVAILABLE_TOOLS } from './tool-registry'
import type { ToolDefinition, ToolMetadata } from '../tools/types'
import type { McpToolSource } from './tool-registry'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    riskLevel: 'LOW',
    execute: async () => ({ output: `${name} result` }),
  }
}

function makeMcpSource(tools: ToolMetadata[]): McpToolSource {
  return {
    listRegisteredTools: () => tools,
    execute: async (toolName) => ({ output: `mcp:${toolName} result` }),
  }
}

const builtinTools = [
  makeTool('read'), makeTool('write'), makeTool('edit'),
  makeTool('bash'), makeTool('glob'), makeTool('grep'),
  makeTool('ls'), makeTool('skill'),
]
const builtinRegistry = new BuiltinToolRegistry(builtinTools)

const mcpTools: ToolMetadata[] = [
  { name: 'sqlite_query', description: 'Query SQLite', parameters: {} },
  { name: 'sqlite_execute', description: 'Execute SQLite', parameters: {} },
]

describe('ToolRegistry', () => {

  describe('AC-A3-03: platform Agent — empty allowedTools = no filtering', () => {
    const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set())

    it('returns all builtin + MCP tools', () => {
      const names = registry.getToolNames()
      expect(names).toContain('read')
      expect(names).toContain('bash')
      expect(names).toContain('skill')
      expect(names).toContain('sqlite_query')
      expect(names).toContain('sqlite_execute')
      expect(names).toHaveLength(10) // 8 builtin + 2 MCP
    })
  })

  describe('AC-A3-01: agent declares bash → only bash + ALWAYS_AVAILABLE', () => {
    const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(['bash']))

    it('returns ALWAYS_AVAILABLE + bash', () => {
      const names = registry.getToolNames()
      expect(names).toContain('read')
      expect(names).toContain('ls')
      expect(names).toContain('glob')
      expect(names).toContain('grep')
      expect(names).toContain('skill')
      expect(names).toContain('bash')
      expect(names).not.toContain('write')
      expect(names).not.toContain('edit')
      expect(names).not.toContain('sqlite_query')
      expect(names).toHaveLength(6)
    })
  })

  describe('AC-A3-02: agent declares empty tools → only ALWAYS_AVAILABLE', () => {
    const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(['__placeholder__']))

    it('returns only ALWAYS_AVAILABLE tools', () => {
      const names = registry.getToolNames()
      for (const name of ALWAYS_AVAILABLE_TOOLS) {
        expect(names).toContain(name)
      }
      expect(names).not.toContain('bash')
      expect(names).not.toContain('write')
      expect(names).not.toContain('sqlite_query')
      expect(names).toHaveLength(5)
    })
  })

  it('MCP tool in allowedTools becomes visible', () => {
    const registry = new ToolRegistry(
      builtinRegistry, makeMcpSource(mcpTools),
      new Set(['bash', 'sqlite_query']),
    )
    const names = registry.getToolNames()
    expect(names).toContain('bash')
    expect(names).toContain('sqlite_query')
    expect(names).not.toContain('sqlite_execute')
  })

  it('no MCP source — only builtin tools', () => {
    const registry = new ToolRegistry(builtinRegistry, null, new Set())
    const names = registry.getToolNames()
    expect(names).toHaveLength(8)
    expect(names).not.toContain('sqlite_query')
  })

  it('execute dispatches to builtin tool', async () => {
    const registry = new ToolRegistry(builtinRegistry, null, new Set())
    const result = await registry.execute('bash', {}, { sessionId: 's', workspace: '' })
    expect(result.output).toBe('bash result')
  })

  it('execute dispatches to MCP tool', async () => {
    const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set())
    const result = await registry.execute('sqlite_query', {}, { sessionId: 's', workspace: '' })
    expect(result.output).toBe('mcp:sqlite_query result')
  })

  it('execute throws for unknown tool', async () => {
    const registry = new ToolRegistry(builtinRegistry, null, new Set())
    await expect(registry.execute('nope', {}, { sessionId: 's', workspace: '' }))
      .rejects.toThrow('Tool not found: nope')
  })

  it('hasTool respects whitelist', () => {
    const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(['bash']))
    expect(registry.hasTool('bash')).toBe(true)
    expect(registry.hasTool('read')).toBe(true) // ALWAYS_AVAILABLE
    expect(registry.hasTool('write')).toBe(false) // not in whitelist
    expect(registry.hasTool('sqlite_query')).toBe(false) // MCP not in whitelist
  })
})
