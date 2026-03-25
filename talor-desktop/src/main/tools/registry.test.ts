import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toolRegistry, type ToolDefinition, type ToolExecuteContext, type MCPToolProvider } from './registry'

const mockTool: ToolDefinition = {
  name: 'read',
  description: 'Reads a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  execute: vi.fn(async () => ({ output: 'file content' })),
}

const mockContext: ToolExecuteContext = {
  workspace: '/Users/test',
  sessionId: 'session-1',
}

beforeEach(() => {
  toolRegistry.clear()
})

describe('toolRegistry.register', () => {
  it('should register a tool', () => {
    toolRegistry.register(mockTool)
    expect(toolRegistry.getTool('read')).toBe(mockTool)
  })

  it('should reject duplicate tool names', () => {
    toolRegistry.register(mockTool)
    expect(() => toolRegistry.register(mockTool)).toThrow('Tool already registered: read')
  })

  it('should require name field', () => {
    const noName = { ...mockTool, name: '' }
    expect(() => toolRegistry.register(noName as ToolDefinition)).toThrow('Tool must have a name')
  })

  it('should require description field', () => {
    const noDesc = { ...mockTool, description: '' }
    expect(() => toolRegistry.register(noDesc as ToolDefinition)).toThrow('Tool must have a description')
  })

  it('should require execute function', () => {
    const noExec = { name: 'test', description: 'desc', parameters: {}, execute: undefined }
    expect(() => toolRegistry.register(noExec as unknown as ToolDefinition)).toThrow('Tool must have an execute function')
  })
})

describe('toolRegistry.getTool', () => {
  it('should return tool by name', () => {
    toolRegistry.register(mockTool)
    expect(toolRegistry.getTool('read')).toBe(mockTool)
  })

  it('should return undefined for non-existent tool', () => {
    expect(toolRegistry.getTool('non_existent')).toBeUndefined()
  })
})

describe('toolRegistry.unregister', () => {
  it('should remove a registered tool', () => {
    toolRegistry.register(mockTool)
    toolRegistry.unregister('read')
    expect(toolRegistry.getTool('read')).toBeUndefined()
  })

  it('should throw for non-existent tool', () => {
    expect(() => toolRegistry.unregister('non_existent')).toThrow('Tool not found: non_existent')
  })
})

describe('toolRegistry.clear', () => {
  it('should remove all tools', () => {
    toolRegistry.register(mockTool)
    toolRegistry.register({ ...mockTool, name: 'write', execute: vi.fn() })
    toolRegistry.clear()
    expect(toolRegistry.getTool('read')).toBeUndefined()
    expect(toolRegistry.getTool('write')).toBeUndefined()
  })
})

describe('toolRegistry.getAllSchemas', () => {
  it('should return schemas for all registered tools', () => {
    toolRegistry.register(mockTool)
    toolRegistry.register({ ...mockTool, name: 'write', execute: vi.fn() })
    const schemas = toolRegistry.getAllSchemas()
    expect(schemas).toHaveLength(2)
    expect(schemas.map((s) => s.name)).toEqual(['read', 'write'])
  })

  it('should return empty array when no tools registered', () => {
    expect(toolRegistry.getAllSchemas()).toEqual([])
  })
})

describe('toolRegistry.execute', () => {
  it('should execute a registered tool', async () => {
    toolRegistry.register(mockTool)
    const result = await toolRegistry.execute('read', { path: '/test/file.ts' }, mockContext)
    const callArgs = (mockTool.execute as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[0]).toEqual({ path: '/test/file.ts' })
    expect(callArgs[1].workspace).toBe('/Users/test')
    expect(callArgs[1].sessionId).toBe('session-1')
    expect(callArgs[1].maxReadSizeBytes).toBe(10 * 1024 * 1024)
    expect(result.toolName).toBe('read')
    expect(result.output).toBe('file content')
  })

  it('should throw for non-existent tool', async () => {
    await expect(toolRegistry.execute('non_existent', {}, mockContext)).rejects.toThrow(
      'Tool not found: non_existent',
    )
  })

  it('should include toolCallId in result', async () => {
    toolRegistry.register(mockTool)
    const result = await toolRegistry.execute('read', { path: '/test' }, mockContext)
    expect(result.toolCallId).toBeDefined()
  })

  it('should track duration', async () => {
    toolRegistry.register({
      ...mockTool,
      execute: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10))
        return { toolCallId: 'call-1', toolName: 'read', output: 'done' }
      }),
    })
    const result = await toolRegistry.execute('read', {}, mockContext)
    expect(result.durationMs).toBeGreaterThanOrEqual(10)
  })

  it('should catch and wrap execution errors', async () => {
    toolRegistry.register({
      ...mockTool,
      name: 'failing',
      execute: vi.fn(async () => {
        throw new Error('Intentional test error')
      }),
    })
    const result = await toolRegistry.execute('failing', {}, mockContext)
    expect(result.error).toBe('Intentional test error')
    expect(result.output).toBeUndefined()
  })

  it('should pass context with defaults', async () => {
    const execSpy = vi.fn()
    toolRegistry.register({ ...mockTool, name: 'ctx_test', execute: execSpy })
    await toolRegistry.execute('ctx_test', {}, mockContext)
    const callArgs = execSpy.mock.calls[0]
    expect(callArgs[1].workspace).toBe('/Users/test')
    expect(callArgs[1].sessionId).toBe('session-1')
    expect(callArgs[1].maxReadSizeBytes).toBe(10 * 1024 * 1024)
    expect(callArgs[1].maxWriteSizeBytes).toBe(10 * 1024 * 1024)
    expect(callArgs[1].maxParallelTools).toBe(5)
    expect(callArgs[1].toolTimeoutMs).toBe(30000)
  })
})

describe('toolRegistry.listTools', () => {
  it('should list all registered tool names', () => {
    toolRegistry.register(mockTool)
    toolRegistry.register({ ...mockTool, name: 'write', execute: vi.fn() })
    expect(toolRegistry.listTools()).toEqual(['read', 'write'])
  })
})

describe('toolRegistry.registerExternalProvider', () => {
  const mockProvider: MCPToolProvider = {
    name: 'mcp-server',
    version: '1.0.0',
    listTools: () => [
      { name: 'filesystem_read', description: 'Read from filesystem', parameters: { type: 'object' } },
      { name: 'filesystem_write', description: 'Write to filesystem', parameters: { type: 'object' } },
    ],
    execute: vi.fn(async () => ({ output: 'external result' })),
  }

  it('should register an external provider', () => {
    toolRegistry.registerExternalProvider(mockProvider)
    expect(toolRegistry.getExternalProvider('mcp-server')).toBe(mockProvider)
  })

  it('should reject duplicate provider names', () => {
    toolRegistry.registerExternalProvider(mockProvider)
    expect(() => toolRegistry.registerExternalProvider(mockProvider)).toThrow(
      'Provider already registered: mcp-server',
    )
  })

  it('should require provider name', () => {
    const noName = { ...mockProvider, name: '' }
    expect(() => toolRegistry.registerExternalProvider(noName as MCPToolProvider)).toThrow(
      'Provider must have a name',
    )
  })

  it('should require listTools function', () => {
    const noListTools = { name: 'test', listTools: undefined }
    expect(() => toolRegistry.registerExternalProvider(noListTools as unknown as MCPToolProvider)).toThrow(
      'Provider must have a listTools function',
    )
  })

  it('should require execute function', () => {
    const noExecute = { name: 'test', listTools: () => [], execute: undefined }
    expect(() => toolRegistry.registerExternalProvider(noExecute as unknown as MCPToolProvider)).toThrow(
      'Provider must have an execute function',
    )
  })
})

describe('toolRegistry.unregisterExternalProvider', () => {
  const mockProvider: MCPToolProvider = {
    name: 'test-provider',
    listTools: () => [],
    execute: vi.fn(),
  }

  it('should remove a registered provider', () => {
    toolRegistry.registerExternalProvider(mockProvider)
    toolRegistry.unregisterExternalProvider('test-provider')
    expect(toolRegistry.getExternalProvider('test-provider')).toBeUndefined()
  })

  it('should throw for non-existent provider', () => {
    expect(() => toolRegistry.unregisterExternalProvider('non_existent')).toThrow(
      'Provider not found: non_existent',
    )
  })
})

describe('toolRegistry.listExternalProviders', () => {
  it('should list all registered provider names', () => {
    toolRegistry.registerExternalProvider({
      name: 'provider-a',
      listTools: () => [],
      execute: vi.fn(),
    })
    toolRegistry.registerExternalProvider({
      name: 'provider-b',
      listTools: () => [],
      execute: vi.fn(),
    })
    expect(toolRegistry.listExternalProviders()).toEqual(['provider-a', 'provider-b'])
  })

  it('should return empty array when no providers registered', () => {
    expect(toolRegistry.listExternalProviders()).toEqual([])
  })
})

describe('toolRegistry.listAllTools', () => {
  const mockProvider: MCPToolProvider = {
    name: 'mcp-server',
    listTools: () => [
      { name: 'ext_tool_1', description: 'External tool 1', parameters: { type: 'object' } },
      { name: 'ext_tool_2', description: 'External tool 2', parameters: { type: 'object' } },
    ],
    execute: vi.fn(),
  }

  it('should merge builtin and external tools', () => {
    toolRegistry.register(mockTool)
    toolRegistry.registerExternalProvider(mockProvider)
    const allTools = toolRegistry.listAllTools()
    expect(allTools).toHaveLength(3)
    expect(allTools.map((t) => t.name)).toEqual(['read', 'ext_tool_1', 'ext_tool_2'])
  })

  it('should mark builtin tools with provider=builtin', () => {
    toolRegistry.register(mockTool)
    const allTools = toolRegistry.listAllTools()
    expect(allTools.find((t) => t.name === 'read')?.provider).toBe('builtin')
  })

  it('should mark external tools with provider name', () => {
    toolRegistry.registerExternalProvider(mockProvider)
    const allTools = toolRegistry.listAllTools()
    expect(allTools.find((t) => t.name === 'ext_tool_1')?.provider).toBe('mcp-server')
  })

  it('should return builtin tools only when no external providers', () => {
    toolRegistry.register(mockTool)
    toolRegistry.register({ ...mockTool, name: 'write', execute: vi.fn() })
    const allTools = toolRegistry.listAllTools()
    expect(allTools).toHaveLength(2)
    expect(allTools.every((t) => t.provider === 'builtin')).toBe(true)
  })
})

describe('toolRegistry.getToolFromExternal', () => {
  const mockProvider: MCPToolProvider = {
    name: 'test-provider',
    listTools: () => [
      { name: 'external_tool', description: 'An external tool', parameters: { type: 'object' } },
    ],
    execute: vi.fn(),
  }

  it('should find tool in external provider', () => {
    toolRegistry.registerExternalProvider(mockProvider)
    const result = toolRegistry.getToolFromExternal('external_tool')
    expect(result).toBeDefined()
    expect(result?.provider.name).toBe('test-provider')
  })

  it('should return undefined for non-existent external tool', () => {
    toolRegistry.registerExternalProvider(mockProvider)
    expect(toolRegistry.getToolFromExternal('non_existent')).toBeUndefined()
  })
})

describe('toolRegistry.execute with external tools', () => {
  const mockProvider: MCPToolProvider = {
    name: 'exec-provider',
    listTools: () => [
      { name: 'remote_exec', description: 'Execute remotely', parameters: { type: 'object' } },
    ],
    execute: vi.fn(async (name, input) => ({ output: `executed ${name} with ${JSON.stringify(input)}` })),
  }

  it('should execute tool from external provider', async () => {
    toolRegistry.registerExternalProvider(mockProvider)
    const result = await toolRegistry.execute('remote_exec', { cmd: 'ls' }, mockContext)
    expect(result.output).toBe('executed remote_exec with {"cmd":"ls"}')
    expect(result.toolName).toBe('remote_exec')
  })

  it('should prioritize builtin over external tools', async () => {
    toolRegistry.register(mockTool)
    toolRegistry.registerExternalProvider(mockProvider)
    const result = await toolRegistry.execute('read', { path: '/test' }, mockContext)
    expect(result.output).toBe('file content')
  })

  it('should catch execution errors from external provider', async () => {
    const failingProvider: MCPToolProvider = {
      name: 'failing',
      listTools: () => [{ name: 'fail_tool', description: 'Fails', parameters: {} }],
      execute: vi.fn(async () => {
        throw new Error('External provider error')
      }),
    }
    toolRegistry.registerExternalProvider(failingProvider)
    const result = await toolRegistry.execute('fail_tool', {}, mockContext)
    expect(result.error).toBe('External provider error')
  })
})

describe('toolRegistry.clear with external providers', () => {
  it('should clear both builtin tools and external providers', () => {
    toolRegistry.register(mockTool)
    toolRegistry.registerExternalProvider({
      name: 'test-provider',
      listTools: () => [],
      execute: vi.fn(),
    })
    toolRegistry.clear()
    expect(toolRegistry.getTool('read')).toBeUndefined()
    expect(toolRegistry.listExternalProviders()).toEqual([])
  })
})
