import { describe, it, expect } from 'vitest'
import { BuiltinToolRegistry } from './builtin-registry'
import { ToolRegistry } from './agent-toolset'
import type { ToolDefinition, ToolMetadata } from '../tools/types'
import type { McpToolSource } from './agent-toolset'

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
  makeTool('read'),
  makeTool('write'),
  makeTool('edit'),
  makeTool('bash'),
  makeTool('glob'),
  makeTool('grep'),
  makeTool('ls'),
  makeTool('skill'),
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
    const registry = new ToolRegistry(
      builtinRegistry,
      makeMcpSource(mcpTools),
      new Set(['__placeholder__']),
    )

    it('returns only ALWAYS_AVAILABLE tools that exist in the registry', () => {
      // ALWAYS_AVAILABLE_TOOLS = pass-through allowlist set, not a "must be present" set.
      // search_tool is in ALWAYS_AVAILABLE_TOOLS but isn't injected in this fixture.
      const names = registry.getToolNames()
      expect(names).toContain('read')
      expect(names).toContain('ls')
      expect(names).toContain('glob')
      expect(names).toContain('grep')
      expect(names).toContain('skill')
      expect(names).not.toContain('bash')
      expect(names).not.toContain('write')
      expect(names).not.toContain('sqlite_query')
      expect(names).not.toContain('search_tool') // not in fixture
      expect(names).toHaveLength(5)
    })
  })

  it('MCP tool in allowedTools becomes visible', () => {
    const registry = new ToolRegistry(
      builtinRegistry,
      makeMcpSource(mcpTools),
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
    await expect(registry.execute('nope', {}, { sessionId: 's', workspace: '' })).rejects.toThrow(
      'Tool not found: nope',
    )
  })

  it('hasTool respects whitelist', () => {
    const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(['bash']))
    expect(registry.hasTool('bash')).toBe(true)
    expect(registry.hasTool('read')).toBe(true) // ALWAYS_AVAILABLE
    expect(registry.hasTool('write')).toBe(false) // not in whitelist
    expect(registry.hasTool('sqlite_query')).toBe(false) // MCP not in whitelist
  })

  describe('split methods (listBuiltinTools / listMcpTools)', () => {
    const searchToolDef = makeTool('search_tool')

    describe('AC-2-1: listBuiltinTools includes search_tool when MCP present', () => {
      it('exposes search_tool when mcpRegistry has at least one tool', () => {
        const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(), [
          searchToolDef,
        ])
        const names = registry.listBuiltinTools().map((t) => t.name)
        expect(names).toContain('search_tool')
        // 8 builtin (含 fixture 的 'skill') + search_tool = 9
        expect(names).toHaveLength(9)
      })
    })

    describe('AC-2-2: listBuiltinTools excludes search_tool when no MCP', () => {
      it('hides search_tool when mcpRegistry returns empty', () => {
        const registry = new ToolRegistry(builtinRegistry, makeMcpSource([]), new Set(), [
          searchToolDef,
        ])
        const names = registry.listBuiltinTools().map((t) => t.name)
        expect(names).not.toContain('search_tool')
        expect(names).toHaveLength(8)
      })

      it('hides search_tool when mcpRegistry is null', () => {
        const registry = new ToolRegistry(builtinRegistry, null, new Set(), [searchToolDef])
        const names = registry.listBuiltinTools().map((t) => t.name)
        expect(names).not.toContain('search_tool')
      })
    })

    describe('AC-2-3: listMcpTools returns only MCP tools', () => {
      it('returns only MCP tools, no builtin', () => {
        const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(), [
          searchToolDef,
        ])
        const names = registry.listMcpTools().map((t) => t.name)
        expect(names).toEqual(['sqlite_query', 'sqlite_execute'])
        expect(names).not.toContain('search_tool')
        expect(names).not.toContain('read')
      })

      it('returns empty array when mcpRegistry is null', () => {
        const registry = new ToolRegistry(builtinRegistry, null, new Set())
        expect(registry.listMcpTools()).toEqual([])
      })
    })

    describe('AC-2-4: listTools equals listBuiltinTools + listMcpTools', () => {
      it('preserves backward compatibility', () => {
        const registry = new ToolRegistry(builtinRegistry, makeMcpSource(mcpTools), new Set(), [
          searchToolDef,
        ])
        const builtin = registry.listBuiltinTools().map((t) => t.name)
        const mcp = registry.listMcpTools().map((t) => t.name)
        const all = registry.listTools().map((t) => t.name)
        expect(all).toEqual([...builtin, ...mcp])
      })
    })

    it('search_tool is in ALWAYS_AVAILABLE_TOOLS (allowlist passthrough)', () => {
      // allowlist 限制为 ['bash']，search_tool 不在 allowlist 但应通过 ALWAYS_AVAILABLE
      const registry = new ToolRegistry(
        builtinRegistry,
        makeMcpSource(mcpTools),
        new Set(['bash']),
        [searchToolDef],
      )
      const names = registry.listBuiltinTools().map((t) => t.name)
      expect(names).toContain('search_tool')
    })
  })

  describe('disabledTools (TASK-4, AC-019: 通用机制)', () => {
    it('AC-019 (trigger): listTools excludes disabled tools', () => {
      const registry = new ToolRegistry(
        builtinRegistry,
        null,
        new Set(), // platform-style: no allowlist
        [],
        new Set(['bash', 'write']),
      )
      const names = registry.getToolNames()
      expect(names).not.toContain('bash')
      expect(names).not.toContain('write')
      expect(names).toContain('read') // not disabled
    })

    it('AC-019 (no-trigger): empty disabledTools means nothing filtered', () => {
      const registry = new ToolRegistry(builtinRegistry, null, new Set(), [], new Set())
      const names = registry.getToolNames()
      expect(names).toContain('bash')
      expect(names).toContain('write')
    })

    it('disabledTools applies even when allowedTools whitelist is set', () => {
      const registry = new ToolRegistry(
        builtinRegistry,
        null,
        new Set(['bash', 'write']), // explicitly allowed
        [],
        new Set(['bash']), // but disabled wins
      )
      const names = registry.getToolNames()
      expect(names).not.toContain('bash')
      expect(names).toContain('write')
    })

    it('execute() path is NOT filtered by disabledTools (internal helpers can still call)', async () => {
      const registry = new ToolRegistry(builtinRegistry, null, new Set(), [], new Set(['bash']))
      // bash is disabled in listTools, but execute should still find and run it
      const result = await registry.execute(
        'bash',
        {},
        {} as Parameters<typeof registry.execute>[2],
      )
      expect(result.output).toBe('bash result')
    })
  })
})
