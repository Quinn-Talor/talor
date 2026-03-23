import { describe, it, expect } from 'vitest'
import type {
  ToolDefinition,
  ToolResult,
  ToolCallLog,
  ToolConfig,
  ToolCallStatus,
  ToolExecuteContext,
} from './types'

// Helper to create minimal ToolDefinition for testing
function createMockTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'mock_tool',
    description: 'A mock tool for testing',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
      required: ['input'],
    },
    execute: async () => ({ output: 'mock_result' }),
    ...overrides,
  }
}

describe('ToolDefinition', () => {
  it('should require name field', () => {
    const tool = createMockTool({ name: 'read' })
    expect(tool.name).toBe('read')
  })

  it('should require description field', () => {
    const tool = createMockTool({ description: 'Reads a file' })
    expect(tool.description).toBe('Reads a file')
  })

  it('should require parameters as JSON schema', () => {
    const tool = createMockTool({
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    })
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.properties).toHaveProperty('path')
  })

  it('should have optional execute function', () => {
    const tool = createMockTool()
    expect(typeof tool.execute).toBe('function')
  })

  it('should support schema field as alternative to parameters', () => {
    const tool = createMockTool({
      schema: { type: 'object', properties: {} },
    } as Partial<{ schema: Record<string, unknown> }>)
    expect(tool).toHaveProperty('schema')
  })
})

describe('ToolResult', () => {
  it('should have toolCallId', () => {
    const result: ToolResult = {
      toolCallId: 'call-123',
      toolName: 'read',
      output: 'file content',
    }
    expect(result.toolCallId).toBe('call-123')
  })

  it('should have toolName', () => {
    const result: ToolResult = {
      toolCallId: 'call-123',
      toolName: 'read',
      output: 'file content',
    }
    expect(result.toolName).toBe('read')
  })

  it('should have either output or error', () => {
    const successResult: ToolResult = {
      toolCallId: 'call-1',
      toolName: 'read',
      output: 'content',
    }
    expect(successResult.output).toBe('content')
    expect(successResult.error).toBeUndefined()

    const errorResult: ToolResult = {
      toolCallId: 'call-2',
      toolName: 'read',
      error: 'File not found',
    }
    expect(errorResult.output).toBeUndefined()
    expect(errorResult.error).toBe('File not found')
  })

  it('should track execution duration', () => {
    const result: ToolResult = {
      toolCallId: 'call-123',
      toolName: 'read',
      output: 'content',
      durationMs: 150,
    }
    expect(result.durationMs).toBe(150)
  })
})

describe('ToolCallLog', () => {
  it('should record tool call with session context', () => {
    const log: ToolCallLog = {
      id: 'log-1',
      sessionId: 'session-abc',
      toolCallId: 'call-123',
      toolName: 'read',
      input: { path: 'src/index.ts' },
      status: 'success',
      startTime: '2026-03-23T10:00:00.000Z',
      endTime: '2026-03-23T10:00:00.150Z',
    }
    expect(log.sessionId).toBe('session-abc')
    expect(log.toolName).toBe('read')
  })

  it('should support parallel group tracking', () => {
    const log: ToolCallLog = {
      id: 'log-1',
      sessionId: 'session-abc',
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'a.txt' },
      status: 'success',
      startTime: '2026-03-23T10:00:00.000Z',
      endTime: '2026-03-23T10:00:00.100Z',
      parallelGroup: 'group-1',
    }
    expect(log.parallelGroup).toBe('group-1')
  })

  it('should support all status values', () => {
    const statuses: ToolCallStatus[] = ['pending', 'running', 'success', 'error', 'timeout']
    statuses.forEach((status) => {
      const log: ToolCallLog = {
        id: `log-${status}`,
        sessionId: 'session-1',
        toolCallId: 'call-1',
        toolName: 'test',
        input: {},
        status,
        startTime: '2026-03-23T10:00:00.000Z',
        endTime: '2026-03-23T10:00:00.100Z',
      }
      expect(log.status).toBe(status)
    })
  })

  it('should record error information', () => {
    const log: ToolCallLog = {
      id: 'log-1',
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: '/etc/passwd' },
      status: 'error',
      startTime: '2026-03-23T10:00:00.000Z',
      endTime: '2026-03-23T10:00:00.010Z',
      error: 'Access denied: path outside workspace',
    }
    expect(log.status).toBe('error')
    expect(log.error).toBe('Access denied: path outside workspace')
  })
})

describe('ToolConfig', () => {
  it('should require workspace', () => {
    const config: ToolConfig = {
      workspace: '/Users/test/project',
    }
    expect(config.workspace).toBe('/Users/test/project')
  })

  it('should support custom size limits', () => {
    const config: ToolConfig = {
      workspace: '/Users/test/project',
      maxReadSizeBytes: 5 * 1024 * 1024,
      maxWriteSizeBytes: 5 * 1024 * 1024,
      maxParallelTools: 3,
    }
    expect(config.maxReadSizeBytes).toBe(5 * 1024 * 1024)
    expect(config.maxWriteSizeBytes).toBe(5 * 1024 * 1024)
    expect(config.maxParallelTools).toBe(3)
  })

  it('should support custom timeout', () => {
    const config: ToolConfig = {
      workspace: '/Users/test/project',
      toolTimeoutMs: 60000,
    }
    expect(config.toolTimeoutMs).toBe(60000)
  })

  it('should have all fields as optional except workspace', () => {
    const config: ToolConfig = {
      workspace: '/Users/test/project',
    }
    expect(config.workspace).toBeDefined()
    expect(config.maxReadSizeBytes).toBeUndefined()
    expect(config.maxWriteSizeBytes).toBeUndefined()
    expect(config.maxParallelTools).toBeUndefined()
    expect(config.toolTimeoutMs).toBeUndefined()
  })
})

describe('ToolExecuteContext', () => {
  it('should provide workspace path', () => {
    const ctx: ToolExecuteContext = {
      workspace: '/Users/test/project',
      sessionId: 'session-1',
    }
    expect(ctx.workspace).toBe('/Users/test/project')
  })

  it('should provide sessionId', () => {
    const ctx: ToolExecuteContext = {
      workspace: '/Users/test/project',
      sessionId: 'session-abc',
    }
    expect(ctx.sessionId).toBe('session-abc')
  })

  it('should merge with toolConfig', () => {
    const ctx: ToolExecuteContext = {
      workspace: '/Users/test/project',
      sessionId: 'session-1',
      maxReadSizeBytes: 5 * 1024 * 1024,
    }
    expect(ctx.maxReadSizeBytes).toBe(5 * 1024 * 1024)
  })
})
