// HttpTransport:body 读取超时、SSE 流式取响应、session 过期(404)重新 initialize

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.stubGlobal('fetch', h.fetch)

import { HttpTransport } from './http'
import { MCPTimeoutError } from '../types'

const INIT_RESULT = {
  protocolVersion: '2025-03-26',
  serverInfo: { name: 'session-test', version: '1.0' },
  capabilities: { tools: {} },
}

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

function notFound() {
  return { ok: false, status: 404, statusText: 'Not Found', headers: headersOf({}) }
}

/** SSE 响应体:先推送给定 chunks,之后保持打开(不 close),模拟服务端不关流。 */
function openSseResp(chunks: string[], signal: AbortSignal) {
  const encoder = new TextEncoder()
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      signal.addEventListener('abort', () => {
        try {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        } catch {
          // 流已被 cancel
        }
      })
    },
    cancel,
  })
  return {
    resp: {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: headersOf({ 'content-type': 'text/event-stream' }),
      body,
      text: () => new Promise<string>(() => {}),
    },
    cancel,
  }
}

function sseEvent(obj: unknown): string {
  return `event: message\ndata: ${JSON.stringify(obj)}\n\n`
}

function makeTransport(timeoutMs = 5000) {
  return new HttpTransport(
    {
      id: 'h',
      name: 'Session Test',
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      enabled: true,
    },
    timeoutMs,
  )
}

function bodyOf(call: unknown[]): { id?: string; method: string } {
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe('HttpTransport body timeout and SSE streaming', () => {
  beforeEach(() => {
    h.fetch.mockReset()
  })

  it('returns as soon as the matching SSE response arrives, without waiting for stream close', async () => {
    const cancels: Array<ReturnType<typeof vi.fn>> = []
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize') return jsonResp(body.id, INIT_RESULT)
      if (body.method === 'tools/list') {
        const { resp, cancel } = openSseResp(
          [
            sseEvent({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }),
            sseEvent({ jsonrpc: '2.0', id: 'other', result: { tools: [{ name: 'wrong' }] } }),
            sseEvent({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'right' }] } }),
          ],
          o.signal as AbortSignal,
        )
        cancels.push(cancel)
        return resp
      }
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport()
    await t.connect()
    const tools = await t.listTools()

    expect(tools).toEqual([{ name: 'right' }])
    expect(cancels[0]).toHaveBeenCalled()
  })

  it('times out when an SSE stream stays open without the matching response', async () => {
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize') return jsonResp(body.id, INIT_RESULT)
      if (body.method === 'tools/list') {
        return openSseResp([': heartbeat\n\n'], o.signal as AbortSignal).resp
      }
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport(100)
    await t.connect()
    await expect(t.listTools()).rejects.toBeInstanceOf(MCPTimeoutError)
  })

  it('times out when a JSON body never finishes after headers arrive', async () => {
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize') return jsonResp(body.id, INIT_RESULT)
      if (body.method === 'tools/list') {
        const signal = o.signal as AbortSignal
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: headersOf({ 'content-type': 'application/json' }),
          json: () =>
            new Promise((_, reject) =>
              signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              ),
            ),
        }
      }
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport(100)
    await t.connect()
    await expect(t.listTools()).rejects.toThrow(/tools\/list timed out/)
  })
})

describe('HttpTransport session expiry', () => {
  beforeEach(() => {
    h.fetch.mockReset()
  })

  it('re-initializes and retries once when a request with a session id gets 404', async () => {
    let initCount = 0
    let listCount = 0
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      const headers = o.headers as Record<string, string>
      if (body.method === 'initialize') {
        initCount++
        return jsonResp(body.id, INIT_RESULT, { 'mcp-session-id': `sess-${initCount}` })
      }
      if (body.method === 'tools/list') {
        listCount++
        if (headers['Mcp-Session-Id'] === 'sess-1') return notFound()
        return jsonResp(body.id, { tools: [{ name: 'after-reinit' }] })
      }
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport()
    await t.connect()
    const tools = await t.listTools()

    expect(tools).toEqual([{ name: 'after-reinit' }])
    expect(initCount).toBe(2)
    expect(listCount).toBe(2)
    const lastList = h.fetch.mock.calls.filter((c) => bodyOf(c).method === 'tools/list').pop()!
    expect((lastList[1].headers as Record<string, string>)['Mcp-Session-Id']).toBe('sess-2')
    expect(t.isConnected()).toBe(true)
  })

  it('does not re-initialize on 404 when no session id was sent', async () => {
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize') return jsonResp(body.id, INIT_RESULT)
      if (body.method === 'tools/list') return notFound()
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport()
    await t.connect()
    await expect(t.listTools()).rejects.toThrow('HTTP 404')
    expect(h.fetch.mock.calls.filter((c) => bodyOf(c).method === 'initialize')).toHaveLength(1)
  })

  it('gives up after one re-initialize when the server keeps returning 404', async () => {
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      if (body.method === 'initialize')
        return jsonResp(body.id, INIT_RESULT, { 'mcp-session-id': 's' })
      if (body.method === 'tools/list') return notFound()
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport()
    await t.connect()
    await expect(t.listTools()).rejects.toThrow(/404/)
    expect(h.fetch.mock.calls.filter((c) => bodyOf(c).method === 'initialize')).toHaveLength(2)
    expect(h.fetch.mock.calls.filter((c) => bodyOf(c).method === 'tools/list')).toHaveLength(2)
  })

  it('shares one re-initialize between concurrent requests that hit 404', async () => {
    let initCount = 0
    h.fetch.mockImplementation(async (_u: string, o: RequestInit) => {
      const body = JSON.parse(o.body as string)
      const headers = o.headers as Record<string, string>
      if (body.method === 'initialize') {
        initCount++
        return jsonResp(body.id, INIT_RESULT, { 'mcp-session-id': `sess-${initCount}` })
      }
      if (body.method === 'tools/call') {
        if (headers['Mcp-Session-Id'] === 'sess-1') return notFound()
        return jsonResp(body.id, { content: [{ type: 'text', text: 'ok' }] })
      }
      return jsonResp(body.id ?? 'n', {})
    })

    const t = makeTransport()
    await t.connect()
    const results = await Promise.all([t.callTool('a', {}), t.callTool('b', {})])

    expect(results.map((r) => r.content[0].text)).toEqual(['ok', 'ok'])
    expect(initCount).toBe(2)
  })
})
