import { describe, it, expect, vi, beforeEach } from 'vitest'

// MCP Streamable HTTP transport conformance:
// - Accept: application/json, text/event-stream (missing → tushare etc. return HTTP 406)
// - parse text/event-stream (SSE) responses, not only application/json
// - capture Mcp-Session-Id from initialize and resend it on subsequent requests
// - send MCP-Protocol-Version header on post-initialize requests
// - send notifications/initialized after the handshake (best-effort)

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { HttpTransport } from './http'

function headersOf(map: Record<string, string>) {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (k: string) => lower.get(k.toLowerCase()) ?? null }
}

function jsonResp(id: string, result: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: headersOf({ 'content-type': 'application/json', ...extraHeaders }),
    json: async () => ({ jsonrpc: '2.0', id, result }),
  }
}

function sseResp(id: string, result: unknown, extraHeaders: Record<string, string> = {}) {
  const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: headersOf({ 'content-type': 'text/event-stream', ...extraHeaders }),
    text: async () => body,
  }
}

const INIT_RESULT = {
  protocolVersion: '2025-03-26',
  serverInfo: { name: 'streamable-test', version: '1.0' },
  capabilities: { tools: {} },
}

function makeTransport() {
  return new HttpTransport({
    id: 'sh',
    name: 'Streamable Test',
    type: 'http',
    url: 'https://mcp.example.com/mcp',
    enabled: true,
  })
}

describe('HttpTransport — Streamable HTTP conformance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('sends Accept: application/json, text/event-stream on every request', async () => {
    mockFetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      return jsonResp(body.id, body.method === 'initialize' ? INIT_RESULT : { tools: [] })
    })
    const t = makeTransport()
    await t.connect()
    await t.listTools()

    for (const call of mockFetch.mock.calls) {
      const accept = (call[1].headers as Record<string, string>)['Accept']
      expect(accept).toContain('application/json')
      expect(accept).toContain('text/event-stream')
    }
  })

  it('parses SSE (text/event-stream) responses', async () => {
    mockFetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize') return sseResp(body.id, INIT_RESULT)
      if (body.method === 'tools/list')
        return sseResp(body.id, {
          tools: [{ name: 'remote_x', description: 'd', inputSchema: {} }],
        })
      return jsonResp(body.id, {})
    })
    const t = makeTransport()
    await t.connect()
    const tools = await t.listTools()
    expect(t.isConnected()).toBe(true)
    expect(tools[0].name).toBe('remote_x')
  })

  it('captures Mcp-Session-Id from initialize and resends it', async () => {
    mockFetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize')
        return jsonResp(body.id, INIT_RESULT, { 'mcp-session-id': 'sess-42' })
      return jsonResp(body.id, { tools: [] })
    })
    const t = makeTransport()
    await t.connect()
    await t.listTools()

    const listCall = mockFetch.mock.calls.find((c) => JSON.parse(c[1].body).method === 'tools/list')
    expect((listCall![1].headers as Record<string, string>)['Mcp-Session-Id']).toBe('sess-42')
  })

  it('sends MCP-Protocol-Version on post-initialize requests but not on initialize', async () => {
    mockFetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      return jsonResp(body.id, body.method === 'initialize' ? INIT_RESULT : { tools: [] })
    })
    const t = makeTransport()
    await t.connect()
    await t.listTools()

    const initCall = mockFetch.mock.calls.find((c) => JSON.parse(c[1].body).method === 'initialize')
    const listCall = mockFetch.mock.calls.find((c) => JSON.parse(c[1].body).method === 'tools/list')
    expect((initCall![1].headers as Record<string, string>)['MCP-Protocol-Version']).toBeUndefined()
    expect((listCall![1].headers as Record<string, string>)['MCP-Protocol-Version']).toBe(
      '2025-03-26',
    )
  })

  it('sends notifications/initialized after the handshake', async () => {
    mockFetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      return jsonResp(body.id ?? 'n', body.method === 'initialize' ? INIT_RESULT : {})
    })
    const t = makeTransport()
    await t.connect()

    const notif = mockFetch.mock.calls.find(
      (c) => JSON.parse(c[1].body).method === 'notifications/initialized',
    )
    expect(notif).toBeDefined()
    // notifications carry no id
    expect(JSON.parse(notif![1].body).id).toBeUndefined()
  })

  it('connect still succeeds if the initialized notification fails (best-effort)', async () => {
    mockFetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize') return jsonResp(body.id, INIT_RESULT)
      if (body.method === 'notifications/initialized') throw new Error('network blip')
      return jsonResp(body.id, {})
    })
    const t = makeTransport()
    await expect(t.connect()).resolves.toBeUndefined()
    expect(t.isConnected()).toBe(true)
  })
})
