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

vi.mock('../tools/types', () => ({
  ToolExecuteContext: {},
}))

vi.mock('./transport/stdio', () => ({
  StdioTransport: vi.fn(),
}))

vi.mock('./transport/http', () => ({
  HttpTransport: vi.fn(),
}))

import { mcpServerRepo } from '../repos/mcp-server-repo'
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

describe('McpRegistry reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns immediate error and triggers background reconnect when disconnected', async () => {
    const mockTransport = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false), // always disconnected after initial connect
      listTools: vi.fn().mockResolvedValue([{ name: 'test_tool', description: 'Test', inputSchema: {} }]),
      callTool: vi.fn().mockResolvedValue({ content: [{ text: 'result' }] }),
      serverConfig: { name: 'test-server' },
    }

    vi.mocked(StdioTransport).mockImplementation(() => mockTransport as unknown as InstanceType<typeof StdioTransport>)
    vi.mocked(mcpServerRepo.getById).mockReturnValue(SERVER_FIXTURE)

    const { mcpRegistry } = await import('./client')
    await mcpRegistry.connectServer('server-1')

    const result = await mcpRegistry.execute('test_tool', {}, { sessionId: 's1', workspace: '/tmp' })

    // Fast-fail: immediate error, no blocking reconnect
    expect(result.output).toContain('disconnected')
    expect(result.output).toContain('Reconnecting')
  })
})
