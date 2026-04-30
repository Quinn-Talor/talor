import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import { toolRegistry, type ToolDefinition, type ToolExecuteContext } from './registry'
import { isToolErrorEnvelope } from './types'

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
        await new Promise((r) => setTimeout(r, 20))
        return { output: 'done' }
      }),
    })
    const result = await toolRegistry.execute('read', { path: '/x' }, mockContext)
    // setTimeout 在 CI 上精度偏差大,留 5ms 安全裕度。
    expect(result.durationMs).toBeGreaterThanOrEqual(15)
  })

  it('should catch and wrap execution errors', async () => {
    toolRegistry.register({
      ...mockTool,
      name: 'failing',
      execute: vi.fn(async () => {
        throw new Error('Intentional test error')
      }),
    })
    const result = await toolRegistry.execute('failing', { path: '/x' }, mockContext)
    expect(result.error).toBe('Intentional test error')
    expect(result.output).toBeUndefined()
  })

  it('should pass context with defaults', async () => {
    const execSpy = vi.fn(async () => ({ output: 'ok' }))
    toolRegistry.register({
      ...mockTool,
      name: 'ctx_test',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: execSpy,
    })
    await toolRegistry.execute('ctx_test', {}, mockContext)
    const callArgs = execSpy.mock.calls[0] as unknown as [unknown, ToolExecuteContext]
    expect(callArgs[1].workspace).toBe('/Users/test')
    expect(callArgs[1].sessionId).toBe('session-1')
    expect(callArgs[1].maxReadSizeBytes).toBe(10 * 1024 * 1024)
    expect(callArgs[1].maxWriteSizeBytes).toBe(10 * 1024 * 1024)
    expect(callArgs[1].maxParallelTools).toBe(5)
    expect(callArgs[1].toolTimeoutMs).toBe(30000)
  })
})

describe('toolRegistry.execute Zod validation path', () => {
  it('passes valid input through zod and hands parsed data (with trim) to execute', async () => {
    const schema = z.object({
      command: z.string().trim().min(1),
      count: z.number().int().default(1),
    })
    const execSpy = vi.fn(async (input: { command: string; count: number }) => ({ output: `${input.command} x${input.count}` }))
    toolRegistry.register({
      name: 'zod_ok',
      description: 'zod tool',
      parameters: {},
      zodSchema: schema,
      execute: execSpy as unknown as ToolDefinition['execute'],
    })
    const result = await toolRegistry.execute('zod_ok', { command: '  hello  ' }, mockContext)
    expect(result.output).toBe('hello x1')
    // 验证 execute 收到的是 zod parse 后的 data(trim + default)
    expect(execSpy.mock.calls[0][0]).toEqual({ command: 'hello', count: 1 })
  })

  it('zod missing required → diagnose-style message', async () => {
    toolRegistry.register({
      name: 'zod_missing',
      description: 'zod tool',
      parameters: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } },
      zodSchema: z.object({ command: z.string() }),
      execute: vi.fn(),
    })
    const result = await toolRegistry.execute('zod_missing', {}, mockContext)
    expect(String(result.output)).toMatch(/^Invalid input for tool "zod_missing": missing required parameter/)
  })

  it('zod type mismatch → "Invalid input for tool" message with issue detail', async () => {
    toolRegistry.register({
      name: 'zod_bad_type',
      description: 'zod tool',
      parameters: {},
      zodSchema: z.object({ age: z.number().int().min(0) }),
      execute: vi.fn(),
    })
    const result = await toolRegistry.execute('zod_bad_type', { age: -5 }, mockContext)
    expect(String(result.output)).toMatch(/^Invalid input for tool "zod_bad_type"/)
    expect(String(result.output)).toContain('"age"')
  })

  it('zod enum rejection', async () => {
    toolRegistry.register({
      name: 'zod_enum',
      description: 'zod tool',
      parameters: {},
      zodSchema: z.object({ mode: z.enum(['read', 'write']) }),
      execute: vi.fn(),
    })
    const result = await toolRegistry.execute('zod_enum', { mode: 'execute' }, mockContext)
    expect(String(result.output)).toMatch(/^Invalid input for tool "zod_enum"/)
    expect(String(result.output)).toContain('mode')
  })

  it('zod refine rule blocks bad input', async () => {
    const schema = z.object({
      command: z.string().refine(c => !c.includes('rm -rf'), 'Dangerous command not allowed.'),
    })
    toolRegistry.register({
      name: 'zod_refine',
      description: 'zod tool',
      parameters: {},
      zodSchema: schema,
      execute: vi.fn(async () => ({ output: 'never' })),
    })
    const result = await toolRegistry.execute('zod_refine', { command: 'rm -rf /' }, mockContext)
    expect(String(result.output)).toContain('Dangerous command not allowed.')
  })

  it('no zodSchema → falls back to legacy schema-check (MCP path)', async () => {
    toolRegistry.register({
      name: 'legacy',
      description: 'legacy tool',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' }, mode: { type: 'string', enum: ['r', 'w'] } },
      },
      execute: vi.fn(async () => ({ output: 'ok' })),
    })
    // 缺 required → legacy diagnose
    const missing = await toolRegistry.execute('legacy', {}, mockContext)
    expect(String(missing.output)).toMatch(/^Invalid input for tool "legacy": missing required parameter/)
    // enum 校验(通过 schema-check)
    const badEnum = await toolRegistry.execute('legacy', { path: '/x', mode: 'bad' }, mockContext)
    expect(String(badEnum.output)).toMatch(/^Invalid value for "mode"/)
  })
})

describe('toolRegistry.execute verify behavior', () => {
  it('wraps verify severity="block" as VERIFY_BLOCKED envelope (does NOT fall back to raw)', async () => {
    toolRegistry.register({
      ...mockTool,
      name: 'v_block',
      verify: () => ({ ok: false, output: 'irrelevant', warning: 'hallucination suspected', severity: 'block' }),
    })
    const result = await toolRegistry.execute('v_block', { path: '/x' }, mockContext)
    expect(isToolErrorEnvelope(result.output)).toBe(true)
    const env = result.output as { code: string; message: string }
    expect(env.code).toBe('VERIFY_BLOCKED')
    expect(env.message).toBe('hallucination suspected')
  })

  it('wraps verify throw as VERIFY_CRASH envelope (does NOT fall back to raw)', async () => {
    toolRegistry.register({
      ...mockTool,
      name: 'v_crash',
      verify: () => { throw new Error('verify exploded') },
    })
    const result = await toolRegistry.execute('v_crash', { path: '/x' }, mockContext)
    expect(isToolErrorEnvelope(result.output)).toBe(true)
    const env = result.output as { code: string; message: string }
    expect(env.code).toBe('VERIFY_CRASH')
    expect(env.message).toBe('verify exploded')
  })

  it('allows verify severity="warning" to pass the transformed output through', async () => {
    toolRegistry.register({
      ...mockTool,
      name: 'v_warn',
      verify: () => ({ ok: true, output: 'transformed', warning: 'heads up', severity: 'warning' }),
    })
    const result = await toolRegistry.execute('v_warn', { path: '/x' }, mockContext)
    expect(result.output).toBe('transformed')
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
