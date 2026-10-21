// McpRegistry:连接失败清理 / 重连单飞 / 显式断开不复活 / 并行连接 / 工具结果渲染

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  interface FakeTransport {
    serverConfig: { id: string; name: string }
    connected: boolean
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    isConnected: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>
    callTool: ReturnType<typeof vi.fn>
  }

  const state = {
    instances: [] as FakeTransport[],
    // 每次 new transport 时按顺序取一个 connect 实现;队列空时立即成功。
    connectQueue: [] as Array<() => Promise<void>>,
    callResult: { content: [{ type: 'text', text: 'ok' }] } as unknown,
  }

  const FakeTransportCtor = vi.fn(function (
    this: FakeTransport,
    config: { id: string; name: string },
  ) {
    const connectImpl = state.connectQueue.shift() ?? (async () => {})
    this.serverConfig = config
    this.connected = false
    this.connect = vi.fn(async () => {
      await connectImpl()
      this.connected = true
    })
    this.disconnect = vi.fn(() => {
      this.connected = false
    })
    this.isConnected = vi.fn(() => this.connected)
    this.listTools = vi.fn(async () => [
      { name: `tool_${config.name}`, description: 'd', inputSchema: {} },
    ])
    this.callTool = vi.fn(async () => state.callResult)
    state.instances.push(this)
  })

  const servers = new Map<string, Record<string, unknown>>()
  return { state, FakeTransportCtor, servers }
})

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../repos/mcp-server-repo', () => ({
  mcpServerRepo: {
    getById: vi.fn((id: string) => h.servers.get(id)),
    list: vi.fn(() => [...h.servers.values()]),
  },
}))

vi.mock('./transport/stdio', () => ({ StdioTransport: h.FakeTransportCtor }))
vi.mock('./transport/http', () => ({ HttpTransport: h.FakeTransportCtor }))

import { McpRegistry, renderToolResultContent } from './client'

const CTX = { sessionId: 's1', workspace: '/tmp' }

function addServer(id: string, name = id): void {
  h.servers.set(id, {
    id,
    name,
    type: 'stdio',
    command: 'node',
    args: [],
    enabled: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  })
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  h.state.instances.length = 0
  h.state.connectQueue.length = 0
  h.state.callResult = { content: [{ type: 'text', text: 'ok' }] }
  h.servers.clear()
  h.FakeTransportCtor.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('McpRegistry connect', () => {
  it('disconnects the transport and registers nothing when connect fails', async () => {
    addServer('s1')
    h.state.connectQueue.push(async () => {
      throw new Error('spawn failed')
    })
    const registry = new McpRegistry()

    await expect(registry.connectServer('s1')).rejects.toThrow('spawn failed')
    expect(h.state.instances[0].disconnect).toHaveBeenCalled()
    expect(registry.getConnectedServers()).toEqual([])
    expect(registry.listRegisteredTools()).toEqual([])
  })

  it('keeps the transport and registers its tools when connect succeeds', async () => {
    addServer('s1')
    const registry = new McpRegistry()

    await registry.connectServer('s1')
    expect(h.state.instances[0].disconnect).not.toHaveBeenCalled()
    expect(registry.getConnectedServers()).toEqual(['s1'])
    expect(registry.listRegisteredTools().map((t) => t.name)).toEqual(['tool_s1'])
  })

  it('connectAllEnabled connects servers in parallel, so a hanging server does not block others', async () => {
    addServer('slow')
    addServer('fast')
    const slow = deferred()
    h.state.connectQueue.push(() => slow.promise)
    const registry = new McpRegistry()

    const all = registry.connectAllEnabled()
    await vi.waitFor(() => expect(registry.getConnectedServers()).toEqual(['fast']))

    slow.resolve()
    await all
    expect(registry.getConnectedServers().sort()).toEqual(['fast', 'slow'])
  })

  it('shares one in-flight connect between concurrent connectServer calls', async () => {
    addServer('s1')
    const registry = new McpRegistry()

    await Promise.all([registry.connectServer('s1'), registry.connectServer('s1')])
    expect(h.FakeTransportCtor).toHaveBeenCalledTimes(1)
  })

  it('drops a connection that completes after the server was disconnected', async () => {
    addServer('s1')
    const gate = deferred()
    h.state.connectQueue.push(() => gate.promise)
    const registry = new McpRegistry()

    const connecting = registry.connectServer('s1')
    await registry.disconnectServer('s1')
    gate.resolve()
    await connecting

    expect(h.state.instances[0].disconnect).toHaveBeenCalled()
    expect(registry.getConnectedServers()).toEqual([])
  })
})

describe('McpRegistry reconnect', () => {
  it('runs a single reconnect for concurrent calls and disconnects the replaced transport', async () => {
    vi.useFakeTimers()
    addServer('s1')
    const registry = new McpRegistry()
    await registry.connectServer('s1')
    const original = h.state.instances[0]
    original.connected = false

    const results = await Promise.all([
      registry.execute('tool_s1', {}, CTX),
      registry.execute('tool_s1', {}, CTX),
    ])
    for (const r of results) {
      expect((r.output as { code?: string }).code).toBe('MCP_DISCONNECTED')
    }

    await vi.runAllTimersAsync()

    expect(h.FakeTransportCtor).toHaveBeenCalledTimes(2)
    expect(original.disconnect).toHaveBeenCalled()
    const replacement = h.state.instances[1]
    expect(replacement.disconnect).not.toHaveBeenCalled()

    const after = await registry.execute('tool_s1', {}, CTX)
    expect(after.output).toBe('ok')
    expect(replacement.callTool).toHaveBeenCalled()
  })

  it('does not resurrect a server disconnected while reconnect is in flight', async () => {
    vi.useFakeTimers()
    addServer('s1')
    const registry = new McpRegistry()
    await registry.connectServer('s1')
    h.state.instances[0].connected = false

    const gate = deferred()
    h.state.connectQueue.push(() => gate.promise)
    await registry.execute('tool_s1', {}, CTX)
    // 推过第一次重连延迟,新 transport 进入 connect 等待
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state.instances).toHaveLength(2)

    await registry.disconnectServer('s1')
    gate.resolve()
    await vi.runAllTimersAsync()

    expect(h.state.instances[1].disconnect).toHaveBeenCalled()
    expect(registry.getConnectedServers()).toEqual([])
    expect(registry.listRegisteredTools()).toEqual([])
  })

  it('skips reconnect entirely when disconnected before the retry delay elapses', async () => {
    vi.useFakeTimers()
    addServer('s1')
    const registry = new McpRegistry()
    await registry.connectServer('s1')
    h.state.instances[0].connected = false

    await registry.execute('tool_s1', {}, CTX)
    await registry.disconnectServer('s1')
    await vi.runAllTimersAsync()

    expect(h.FakeTransportCtor).toHaveBeenCalledTimes(1)
    expect(registry.getConnectedServers()).toEqual([])
  })
})

describe('McpRegistry tool result rendering', () => {
  async function run(result: unknown): Promise<unknown> {
    addServer('s1')
    h.state.callResult = result
    const registry = new McpRegistry()
    await registry.connectServer('s1')
    return (await registry.execute('tool_s1', {}, CTX)).output
  }

  it('joins every text block instead of keeping only the first', async () => {
    const output = await run({
      content: [
        { type: 'text', text: 'part 1' },
        { type: 'text', text: 'part 2' },
      ],
    })
    expect(output).toBe('part 1\npart 2')
  })

  it('describes non-text blocks with a placeholder', async () => {
    const output = await run({
      content: [
        { type: 'image', data: 'xx', mimeType: 'image/png' },
        { type: 'text', text: 'caption' },
      ],
    })
    expect(output).toBe('[image: image/png]\ncaption')
  })

  it('treats a successful empty content array as an empty result, not an error', async () => {
    const output = await run({ content: [] })
    expect(output).toBe('(empty result)')
  })

  it('falls back to structuredContent when there is no text', async () => {
    const output = await run({ content: [], structuredContent: { price: 42 } })
    expect(output).toBe('{"price":42}')
  })

  it('reports every text block of an error result', async () => {
    const output = (await run({
      isError: true,
      content: [
        { type: 'text', text: 'bad input' },
        { type: 'text', text: 'field x missing' },
      ],
    })) as { __talor_error?: boolean; code?: string; message?: string }
    expect(output.__talor_error).toBe(true)
    expect(output.code).toBe('MCP_ERROR')
    expect(output.message).toBe('bad input\nfield x missing')
  })

  it('does not append structuredContent when text blocks are present', () => {
    expect(
      renderToolResultContent({
        content: [{ type: 'text', text: 'hello' }],
        structuredContent: { a: 1 },
      }),
    ).toBe('hello')
  })
})
