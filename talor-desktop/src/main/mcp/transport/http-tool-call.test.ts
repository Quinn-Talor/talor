import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { HttpTransport } from './http'

function createJsonRpcResponse(id: string, result: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ jsonrpc: '2.0', id, result }),
  }
}

function createJsonRpcError(id: string, code: number, message: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ jsonrpc: '2.0', id, error: { code, message } }),
  }
}

describe('AC-005-02: MCP HTTP Tool Calling', () => {
  let transport: HttpTransport

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()

    mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      if (body.method === 'initialize') {
        return createJsonRpcResponse(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'http-test-server', version: '1.0' },
          capabilities: { tools: true },
        })
      }
      return createJsonRpcResponse(body.id, { content: [{ type: 'text', text: 'default' }] })
    })

    transport = new HttpTransport({
      id: 'http-server',
      name: 'HTTP Test',
      type: 'http',
      url: 'https://mcp.example.com/api',
      enabled: true,
    })
  })

  it('sends tools/call as HTTP POST with JSON-RPC body', async () => {
    mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      if (body.method === 'initialize') {
        return createJsonRpcResponse(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'test', version: '1.0' },
          capabilities: { tools: true },
        })
      }
      if (body.method === 'tools/call') {
        return createJsonRpcResponse(body.id, {
          content: [{ type: 'text', text: 'http tool result' }],
        })
      }
      return createJsonRpcResponse(body.id, {})
    })

    await transport.connect()
    const result = await transport.callTool('remote_tool', { query: 'test' })

    const toolCallFetch = mockFetch.mock.calls.find((call) => {
      const body = JSON.parse(call[1].body)
      return body.method === 'tools/call'
    })

    expect(toolCallFetch).toBeDefined()
    const requestBody = JSON.parse(toolCallFetch![1].body)
    expect(requestBody.method).toBe('tools/call')
    expect(requestBody.params.name).toBe('remote_tool')
    expect(requestBody.params.arguments).toEqual({ query: 'test' })

    expect(result.content[0].text).toBe('http tool result')
  })

  it('sends requests to configured URL', async () => {
    await transport.connect()
    await transport.callTool('test_tool', {})

    for (const call of mockFetch.mock.calls) {
      expect(call[0]).toBe('https://mcp.example.com/api')
    }
  })

  it('includes Bearer auth header when configured', async () => {
    transport = new HttpTransport({
      id: 'auth-server',
      name: 'Auth Test',
      type: 'http',
      url: 'https://mcp.example.com/api',
      auth: { type: 'bearer', token: 'my-secret-token' },
      enabled: true,
    })

    await transport.connect()
    await transport.callTool('test_tool', {})

    for (const call of mockFetch.mock.calls) {
      expect(call[1].headers).toHaveProperty('Authorization', 'Bearer my-secret-token')
    }
  })

  it('includes API key header when configured', async () => {
    transport = new HttpTransport({
      id: 'apikey-server',
      name: 'APIKey Test',
      type: 'http',
      url: 'https://mcp.example.com/api',
      auth: { type: 'apiKey', apiKey: 'key-12345' },
      enabled: true,
    })

    await transport.connect()
    await transport.callTool('test_tool', {})

    for (const call of mockFetch.mock.calls) {
      expect(call[1].headers).toHaveProperty('X-API-Key', 'key-12345')
    }
  })

  it('handles JSON-RPC error responses from HTTP server', async () => {
    mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      if (body.method === 'initialize') {
        return createJsonRpcResponse(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'test', version: '1.0' },
          capabilities: { tools: true },
        })
      }
      return createJsonRpcError(body.id, -32603, 'Internal error')
    })

    await transport.connect()
    await expect(transport.callTool('failing_tool', {})).rejects.toThrow('Internal error')
  })

  it('handles HTTP error status codes', async () => {
    mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      if (body.method === 'initialize') {
        return createJsonRpcResponse(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'test', version: '1.0' },
          capabilities: { tools: true },
        })
      }
      return { ok: false, status: 500, statusText: 'Internal Server Error' }
    })

    await transport.connect()
    await expect(transport.callTool('test', {})).rejects.toThrow('HTTP 500')
  })
})
