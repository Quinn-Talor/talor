import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('child_process', () => {
  const EventEmitter = require('events')

  class MockProcess extends EventEmitter {
    stdin = { write: vi.fn() }
    stdout = new EventEmitter()
    stderr = new EventEmitter()
    kill = vi.fn()
    pid = 12345
  }

  return {
    spawn: vi.fn(() => {
      const proc = new MockProcess()
      setTimeout(() => {
        proc.stdout.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'test-server', version: '1.0' },
            capabilities: { tools: true },
          },
        }) + '\n')
      }, 10)
      return proc
    }),
  }
})

import { StdioTransport } from './stdio'
import { spawn } from 'child_process'

describe('AC-005-01: MCP STDIO Tool Calling', () => {
  let transport: StdioTransport

  beforeEach(() => {
    vi.clearAllMocks()
    transport = new StdioTransport({
      id: 'test-server',
      name: 'Test Server',
      type: 'stdio',
      command: 'echo',
      args: [],
      enabled: true,
    })
  })

  it('sends tools/call JSON-RPC request via stdin with correct params', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

    const toolCallPromise = transport.callTool('test_tool', { key: 'value' })

    setTimeout(() => {
      mockProcess.stdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        result: {
          content: [{ type: 'text', text: 'tool result' }],
        },
      }) + '\n')
    }, 10)

    const result = await toolCallPromise

    const stdinCalls = mockProcess.stdin.write.mock.calls
    const toolCallRequest = stdinCalls.find((call: unknown[]) => {
      const parsed = JSON.parse(call[0] as string)
      return parsed.method === 'tools/call'
    })

    expect(toolCallRequest).toBeDefined()
    const parsedRequest = JSON.parse(toolCallRequest![0])
    expect(parsedRequest.method).toBe('tools/call')
    expect(parsedRequest.params.name).toBe('test_tool')
    expect(parsedRequest.params.arguments).toEqual({ key: 'value' })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBe('tool result')
  })

  it('spawns child process with correct command, args, and env', async () => {
    transport = new StdioTransport({
      id: 'test-server',
      name: 'Test Server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-test'],
      env: { NODE_ENV: 'test' },
      enabled: true,
    })

    await transport.connect()

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['-y', '@modelcontextprotocol/server-test'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )

    const callArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[2].env).toHaveProperty('NODE_ENV', 'test')
  })

  it('returns MCPToolCallResult with content array structure', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

    const callPromise = transport.callTool('read_file', { path: '/tmp/test.txt' })

    setTimeout(() => {
      mockProcess.stdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        result: {
          content: [{ type: 'text', text: 'file content here' }],
        },
      }) + '\n')
    }, 10)

    const result = await callPromise
    expect(result).toHaveProperty('content')
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content[0]).toEqual({ type: 'text', text: 'file content here' })
  })

  it('rejects with MCPError on JSON-RPC error response', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

    const callPromise = transport.callTool('bad_tool', {})

    setTimeout(() => {
      mockProcess.stdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        error: { code: -32601, message: 'Method not found' },
      }) + '\n')
    }, 10)

    await expect(callPromise).rejects.toThrow('Method not found')
  })

  it('initializes with MCP protocol handshake before tool calls', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value
    const stdinCalls = mockProcess.stdin.write.mock.calls

    expect(stdinCalls.length).toBeGreaterThanOrEqual(1)
    const initRequest = JSON.parse(stdinCalls[0][0])
    expect(initRequest.method).toBe('initialize')
    expect(initRequest.params.protocolVersion).toBe('2024-11-05')
    expect(initRequest.params.clientInfo.name).toBe('talor-desktop')
  })
})
