import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toolRegistry, type ToolDefinition, type ToolExecuteContext } from './registry'

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
    expect(toolRegistry.size).toBe(0)
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

describe('toolRegistry.listAll', () => {
  it('should return all tool definitions', () => {
    toolRegistry.register(mockTool)
    const all = toolRegistry.listAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('read')
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
        return { output: 'done' }
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

describe('toolRegistry.size', () => {
  it('should reflect registered tool count', () => {
    expect(toolRegistry.size).toBe(0)
    toolRegistry.register(mockTool)
    expect(toolRegistry.size).toBe(1)
  })
})
