import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../repos/mcp-server-repo', () => ({
  mcpServerRepo: {
    getById: vi.fn(),
    list: vi.fn(() => []),
  },
  MCPServerType: {},
}))

vi.mock('../tools/registry', () => ({
  toolRegistry: {
    registerExternalProvider: vi.fn(),
    unregisterExternalProvider: vi.fn(),
  },
  ToolExecuteContext: {},
}))

vi.mock('./transport/stdio', () => ({
  StdioTransport: vi.fn(),
}))

vi.mock('./transport/http', () => ({
  HttpTransport: vi.fn(),
}))

import { mcpServerRepo } from '../repos/mcp-server-repo'
import { toolRegistry } from '../tools/registry'
import { StdioTransport } from './transport/stdio'

const SERVER_FIXTURE = {
  id: 'server-1',
  name: 'test-server',
  type: 'stdio' as const,
  command: 'node',
  args: ['server.js'],
  env: null,
  url: null,
  auth: null,
  enabled: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('MCPClientImpl reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconnects stdio server on first attempt when disconnected during tool execution', async () => {
    const mockTransport = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      isConnected: vi.fn()
        .mockReturnValueOnce(false), // execute: server is down → trigger reconnect
      listTools: vi.fn().mockResolvedValue([{ name: 'test_tool', description: 'Test', inputSchema: {} }]),
      callTool: vi.fn().mockResolvedValue({ content: [{ text: 'result' }] }),
      serverConfig: { name: 'test-server' },
    }

    vi.mocked(StdioTransport).mockImplementation(() => mockTransport as unknown as InstanceType<typeof StdioTransport>)
    vi.mocked(mcpServerRepo.getById).mockReturnValue(SERVER_FIXTURE)

    const { mcpClient } = await import('./client')
    await mcpClient.connectServer('server-1')

    const provider = vi.mocked(toolRegistry.registerExternalProvider).mock.calls[0][0]
    const executePromise = provider.execute('test_tool', {}, { sessionId: 's1', workspace: '/tmp' })

    // Advance fake timers so reconnect delay fires
    await vi.runAllTimersAsync()

    const result = await executePromise

    // initial connect + 1 successful reconnect attempt
    expect(mockTransport.connect).toHaveBeenCalledTimes(2)
    expect(result.output).toBe('result')
  })

  it('returns error message after all reconnect attempts fail', async () => {
    const mockTransport = {
      connect: vi.fn()
        .mockResolvedValueOnce(undefined)           // initial connect succeeds
        .mockRejectedValue(new Error('ECONNREFUSED')), // all reconnect attempts fail
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),  // always disconnected
      listTools: vi.fn().mockResolvedValue([{ name: 'test_tool', description: 'Test', inputSchema: {} }]),
      callTool: vi.fn(),
      serverConfig: { name: 'test-server' },
    }

    vi.mocked(StdioTransport).mockImplementation(() => mockTransport as unknown as InstanceType<typeof StdioTransport>)
    vi.mocked(mcpServerRepo.getById).mockReturnValue({ ...SERVER_FIXTURE, id: 'server-2', name: 'test-server' })

    const { mcpClient } = await import('./client')
    await mcpClient.connectServer('server-2')

    const provider = vi.mocked(toolRegistry.registerExternalProvider).mock.calls[0][0]
    const executePromise = provider.execute('test_tool', {}, { sessionId: 's1', workspace: '/tmp' })

    // Advance all reconnect delay timers (1s + 2s + 4s)
    await vi.runAllTimersAsync()

    const result = await executePromise

    // initial + 3 failed reconnect attempts
    expect(mockTransport.connect).toHaveBeenCalledTimes(4)
    expect(result.output).toContain('重连失败')
  })
})
