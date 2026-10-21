import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args),
  },
}))

const transportMocks = vi.hoisted(() => {
  const behavior = {
    connect: vi.fn(async () => {}),
    listTools: vi.fn(async () => [{ name: 'a' }, { name: 'b' }]),
    disconnect: vi.fn(),
  }
  const ctorArgs: Array<{ kind: 'http' | 'stdio'; config: unknown; timeoutMs: unknown }> = []
  function make(kind: 'http' | 'stdio') {
    return vi.fn(function (this: Record<string, unknown>, config: unknown, timeoutMs: unknown) {
      ctorArgs.push({ kind, config, timeoutMs })
      Object.assign(this, behavior)
    })
  }
  return { behavior, ctorArgs, HttpTransport: make('http'), StdioTransport: make('stdio') }
})

vi.mock('../mcp/transport/http', () => ({ HttpTransport: transportMocks.HttpTransport }))
vi.mock('../mcp/transport/stdio', () => ({ StdioTransport: transportMocks.StdioTransport }))

describe('registerMCPHandlers', () => {
  beforeEach(() => {
    mockHandle.mockClear()
  })

  it('registers all MCP IPC handlers', async () => {
    vi.resetModules()
    const { registerMCPHandlers } = await import('./mcp')
    registerMCPHandlers()
    const registeredChannels = mockHandle.mock.calls.map((call) => call[0])
    expect(registeredChannels).toContain('mcp:servers:list')
    expect(registeredChannels).toContain('mcp:servers:create')
    expect(registeredChannels).toContain('mcp:servers:get')
    expect(registeredChannels).toContain('mcp:servers:update')
    expect(registeredChannels).toContain('mcp:servers:delete')
    expect(registeredChannels).toContain('mcp:servers:setEnabled')
    expect(registeredChannels).toContain('mcp:servers:importConfig')
    expect(registeredChannels).toContain('mcp:servers:exportConfig')
  })
})

describe('mcp:servers:testConnection', () => {
  async function getHandler(): Promise<(...args: unknown[]) => Promise<Record<string, unknown>>> {
    vi.resetModules()
    mockHandle.mockClear()
    const { registerMCPHandlers } = await import('./mcp')
    registerMCPHandlers()
    const entry = mockHandle.mock.calls.find((c) => c[0] === 'mcp:servers:testConnection')
    return entry![1] as (...args: unknown[]) => Promise<Record<string, unknown>>
  }

  beforeEach(() => {
    transportMocks.ctorArgs.length = 0
    transportMocks.behavior.connect.mockReset().mockResolvedValue(undefined)
    transportMocks.behavior.listTools.mockReset().mockResolvedValue([{ name: 'a' }, { name: 'b' }])
    transportMocks.behavior.disconnect.mockReset()
  })

  it('tests http servers through HttpTransport connect + listTools and disconnects afterwards', async () => {
    const handler = await getHandler()
    const result = await handler(
      {},
      { type: 'http', url: 'https://mcp.example.com/mcp', auth: { type: 'bearer', token: 't' } },
    )

    expect(result).toMatchObject({ status: 'success', tools_count: 2 })
    expect(typeof result.latency_ms).toBe('number')
    expect(transportMocks.ctorArgs).toHaveLength(1)
    expect(transportMocks.ctorArgs[0].kind).toBe('http')
    expect(transportMocks.ctorArgs[0].config).toMatchObject({
      url: 'https://mcp.example.com/mcp',
      auth: { type: 'bearer', token: 't' },
    })
    expect(transportMocks.behavior.connect).toHaveBeenCalled()
    expect(transportMocks.behavior.disconnect).toHaveBeenCalled()
  })

  it('tests stdio servers through StdioTransport', async () => {
    const handler = await getHandler()
    const result = await handler({}, { type: 'stdio', command: 'node', args: ['s.js'] })

    expect(result).toMatchObject({ status: 'success', tools_count: 2 })
    expect(transportMocks.ctorArgs[0].kind).toBe('stdio')
    expect(transportMocks.behavior.disconnect).toHaveBeenCalled()
  })

  it('reports CONNECTION_FAILED and still disconnects when connect fails', async () => {
    transportMocks.behavior.connect.mockRejectedValue(new Error('HTTP 406: Not Acceptable'))
    const handler = await getHandler()
    const result = await handler({}, { type: 'http', url: 'https://mcp.example.com/mcp' })

    expect(result).toMatchObject({ status: 'failure', error_code: 'CONNECTION_FAILED' })
    expect(result.message).toContain('HTTP 406')
    expect(transportMocks.behavior.disconnect).toHaveBeenCalled()
  })

  it('reports TIMEOUT for transport timeouts', async () => {
    const handler = await getHandler()
    // resetModules 后需取与 handler 同一模块实例的错误类
    const { MCPTimeoutError } = await import('../mcp/types')
    transportMocks.behavior.listTools.mockRejectedValue(
      new MCPTimeoutError('Request tools/list timed out'),
    )
    const result = await handler({}, { type: 'http', url: 'https://mcp.example.com/mcp' })

    expect(result).toMatchObject({ status: 'failure', error_code: 'TIMEOUT' })
  })

  it('returns INVALID_CONFIG without creating a transport when url/command is missing', async () => {
    const handler = await getHandler()
    const result = await handler({}, { type: 'http' })

    expect(result).toMatchObject({ status: 'failure', error_code: 'INVALID_CONFIG' })
    expect(transportMocks.ctorArgs).toHaveLength(0)
  })
})
