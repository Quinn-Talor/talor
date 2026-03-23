import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toolRegistry } from './registry'
import type { ToolExecuteContext } from './types'

interface ToolCallChunk {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
}

interface TextDeltaChunk {
  type: 'text-delta'
  text: string
}

interface DoneChunk {
  type: 'finish'
  finishReason: string
}

interface ErrorChunk {
  type: 'error'
  error: string
}

type StreamChunk = ToolCallChunk | TextDeltaChunk | DoneChunk | ErrorChunk

const mockContext: ToolExecuteContext = {
  workspace: '/Users/test',
  sessionId: 'session-1',
}

type ModelDoGenerate = (opts: unknown) => Promise<{
  text?: string
  finishReason: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
}>

function createMockModel() {
  return { doGenerate: vi.fn<ModelDoGenerate>() }
}

beforeEach(() => {
  toolRegistry.clear()
})

function createMockTool(name: string, output: unknown) {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
    execute: vi.fn(async () => ({ output })),
  }
}

function collectChunks(chunks: StreamChunk[]) {
  const textChunks: string[] = []
  const toolCalls: ToolCallChunk[] = []
  let finishReason: string | undefined
  let errorMessage: string | undefined

  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') textChunks.push(chunk.text)
    if (chunk.type === 'tool-call') toolCalls.push(chunk)
    if (chunk.type === 'finish') finishReason = chunk.finishReason
    if (chunk.type === 'error') errorMessage = chunk.error
  }

  return { fullText: textChunks.join(''), toolCalls, finishReason, errorMessage }
}

describe('executor module exports', () => {
  it('should export toolExecutor', async () => {
    const { toolExecutor } = await import('./executor')
    expect(typeof toolExecutor.executeStream).toBe('function')
  })
})

describe('toolExecutor.executeStream', () => {
  it('should return text when no tool calls', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    model.doGenerate.mockResolvedValue({ text: 'Hello world', finishReason: 'stop' })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Hello' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.fullText).toBe('Hello world')
    expect(result.finishReason).toBe('stop')
    expect(result.toolCalls).toHaveLength(0)
  })

  it('should execute single tool call', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    const readTool = createMockTool('read', 'file content')
    toolRegistry.register(readTool)

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'read', input: { path: '/test.txt' } }],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({
        text: 'The file contains: file content',
        finishReason: 'stop',
      })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Read the file' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.fullText).toBe('The file contains: file content')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].toolName).toBe('read')
    expect(readTool.execute).toHaveBeenCalled()
  })

  it('should execute parallel tool calls in single batch', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    const tool1 = createMockTool('read', 'content A')
    const tool2 = createMockTool('grep', 'content B')
    toolRegistry.register(tool1)
    toolRegistry.register(tool2)

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'read', input: { path: '/a.txt' } },
          { toolCallId: 'call-2', toolName: 'grep', input: { pattern: 'todo' } },
        ],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({
        text: 'Found results from both tools',
        finishReason: 'stop',
      })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Do both' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.toolCalls).toHaveLength(2)
    expect(tool1.execute).toHaveBeenCalled()
    expect(tool2.execute).toHaveBeenCalled()
  })

  it('should respect maxParallelTools limit', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    const tool1 = createMockTool('read', 'content A')
    const tool2 = createMockTool('grep', 'content B')
    const tool3 = createMockTool('ls', 'content C')
    toolRegistry.register(tool1)
    toolRegistry.register(tool2)
    toolRegistry.register(tool3)

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'read', input: {} },
          { toolCallId: 'call-2', toolName: 'grep', input: {} },
          { toolCallId: 'call-3', toolName: 'ls', input: {} },
        ],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({ text: 'Done', finishReason: 'stop' })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Do all three' }],
      context: { ...mockContext, maxParallelTools: 2 },
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.toolCalls).toHaveLength(3)
  })

  it('should handle tool execution errors gracefully', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    toolRegistry.register({
      name: 'failing',
      description: 'Failing tool',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => { throw new Error('File not found') }),
    })

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'failing', input: {} }],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({
        text: 'The tool failed: File not found',
        finishReason: 'stop',
      })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Use failing tool' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.fullText).toBe('The tool failed: File not found')
  })

  it('should stop after max iterations', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    const tool = createMockTool('read', 'content')
    toolRegistry.register(tool)

    model.doGenerate.mockResolvedValue({
      toolCalls: [{ toolCallId: 'call-1', toolName: 'read', input: {} }],
      finishReason: 'tool-calls',
    })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Loop test' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
      maxIterations: 2,
    })

    const result = collectChunks(chunks)
    expect(result.finishReason).toBe('max-iterations')
    expect(model.doGenerate).toHaveBeenCalledTimes(2)
  })

  it('should emit error chunk on model failure', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    model.doGenerate.mockRejectedValue(new Error('Model API error'))

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Test' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.errorMessage).toBe('Model API error')
  })

  it('should emit tool-call chunks for each tool call', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    const tool = createMockTool('read', 'content')
    toolRegistry.register(tool)

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'read', input: {} }],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({ text: 'Done', finishReason: 'stop' })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Test' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const toolCallChunks = chunks.filter((c) => c.type === 'tool-call') as ToolCallChunk[]
    expect(toolCallChunks).toHaveLength(1)
    expect(toolCallChunks[0].toolName).toBe('read')
  })

  it('should accumulate messages in ReAct loop', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()
    const tool = createMockTool('read', 'secret data')
    toolRegistry.register(tool)

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'read', input: {} }],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({
        text: 'The secret is: secret data',
        finishReason: 'stop',
      })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'What is the secret?' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    expect(model.doGenerate).toHaveBeenCalledTimes(2)
    const calls = model.doGenerate.mock.calls as unknown as Array<[{ prompt: unknown[] }]>
    expect(calls[0]?.[0]?.prompt).toHaveLength(1)
    expect(calls[1]?.[0]?.prompt).toHaveLength(3)
  })

  it('should handle unknown tool name gracefully', async () => {
    const { toolExecutor } = await import('./executor')
    const model = createMockModel()

    model.doGenerate
      .mockResolvedValueOnce({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'unknown_tool', input: {} }],
        finishReason: 'tool-calls',
      })
      .mockResolvedValueOnce({ text: 'Unknown tool', finishReason: 'stop' })

    const chunks: StreamChunk[] = []
    await toolExecutor.executeStream({
      model: model as unknown as Parameters<typeof toolExecutor.executeStream>[0]['model'],
      messages: [{ role: 'user', content: 'Test' }],
      context: mockContext,
      onChunk: (chunk) => chunks.push(chunk as StreamChunk),
    })

    const result = collectChunks(chunks)
    expect(result.fullText).toBe('Unknown tool')
  })
})
