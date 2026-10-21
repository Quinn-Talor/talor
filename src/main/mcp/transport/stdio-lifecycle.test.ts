// StdioTransport 帧解析与进程生命周期
//
// - stdout 按换行分帧:单 chunk 多消息 / 消息跨 chunk / 夹杂非 JSON 日志行
// - 子进程退出 / initialize 失败 / disconnect 时在途请求立即 reject,不等超时
// - 请求完成后清掉各自的超时 timer

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events')

  class MockProcess extends EventEmitter {
    stdin = { write: vi.fn(), on: vi.fn() }
    stdout = new EventEmitter()
    stderr = new EventEmitter()
    kill = vi.fn()
  }

  const procs: MockProcess[] = []
  const spawn = vi.fn(() => {
    const proc = new MockProcess()
    procs.push(proc)
    return proc
  })
  return { procs, spawn }
})

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('child_process', () => ({ spawn: h.spawn }))

import { StdioTransport } from './stdio'
import { MCPTimeoutError } from '../types'

const INIT_RESULT = {
  protocolVersion: '2024-11-05',
  serverInfo: { name: 'test', version: '1.0' },
  capabilities: { tools: true },
}

function line(obj: unknown): string {
  return JSON.stringify(obj) + '\n'
}

function makeTransport(timeoutMs = 5000): StdioTransport {
  return new StdioTransport(
    { id: 's', name: 'Lifecycle', type: 'stdio', command: 'node', args: [], enabled: true },
    timeoutMs,
  )
}

async function waitForSpawn(): Promise<(typeof h.procs)[number]> {
  await vi.waitFor(() => expect(h.procs.length).toBeGreaterThan(0))
  return h.procs[h.procs.length - 1]
}

async function connectReady(t: StdioTransport): Promise<(typeof h.procs)[number]> {
  const connecting = t.connect()
  const proc = await waitForSpawn()
  proc.stdout.emit('data', line({ jsonrpc: '2.0', id: '1', result: INIT_RESULT }))
  await connecting
  return proc
}

describe('StdioTransport framing', () => {
  beforeEach(() => {
    h.procs.length = 0
    vi.clearAllMocks()
  })

  it('resolves a response that arrives in the same chunk as a notification', async () => {
    const t = makeTransport()
    const proc = await connectReady(t)

    const listing = t.listTools()
    proc.stdout.emit(
      'data',
      line({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } }) +
        line({ jsonrpc: '2.0', id: '2', result: { tools: [{ name: 'a' }] } }),
    )

    await expect(listing).resolves.toEqual([{ name: 'a' }])
  })

  it('resolves two parallel requests whose responses share one chunk', async () => {
    const t = makeTransport()
    const proc = await connectReady(t)

    const first = t.callTool('x', {})
    const second = t.callTool('y', {})
    proc.stdout.emit(
      'data',
      line({ jsonrpc: '2.0', id: '3', result: { content: [{ type: 'text', text: 'B' }] } }) +
        line({ jsonrpc: '2.0', id: '2', result: { content: [{ type: 'text', text: 'A' }] } }),
    )

    await expect(first).resolves.toEqual({ content: [{ type: 'text', text: 'A' }] })
    await expect(second).resolves.toEqual({ content: [{ type: 'text', text: 'B' }] })
  })

  it('reassembles a message split across chunks and waits while the line is incomplete', async () => {
    const t = makeTransport()
    const proc = await connectReady(t)

    const full = line({ jsonrpc: '2.0', id: '2', result: { tools: [{ name: 'split' }] } })
    let settled = false
    const listing = t.listTools().finally(() => {
      settled = true
    })

    proc.stdout.emit('data', full.slice(0, 20))
    await new Promise((r) => setTimeout(r, 5))
    expect(settled).toBe(false)

    proc.stdout.emit('data', full.slice(20))
    await expect(listing).resolves.toEqual([{ name: 'split' }])
  })

  it('drops non-JSON log lines without blocking later messages', async () => {
    const t = makeTransport()
    const proc = await connectReady(t)

    const listing = t.listTools()
    proc.stdout.emit(
      'data',
      'Server listening on stdio {not json}\n\n' +
        line({ jsonrpc: '2.0', id: '2', result: { tools: [] } }),
    )
    await expect(listing).resolves.toEqual([])

    const next = t.listTools()
    proc.stdout.emit('data', line({ jsonrpc: '2.0', id: '3', result: { tools: [{ name: 'n' }] } }))
    await expect(next).resolves.toEqual([{ name: 'n' }])
  })

  it('does not resolve a pending request from a server-initiated request with the same id', async () => {
    const t = makeTransport(100)
    const proc = await connectReady(t)

    const listing = t.listTools()
    proc.stdout.emit('data', line({ jsonrpc: '2.0', id: '2', method: 'ping' }))

    await expect(listing).rejects.toBeInstanceOf(MCPTimeoutError)
  })
})

describe('StdioTransport process lifecycle', () => {
  beforeEach(() => {
    h.procs.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects connect immediately with exit code and stderr when the server exits on start', async () => {
    const t = makeTransport(60_000)
    const connecting = t.connect()
    const proc = await waitForSpawn()

    proc.stderr.emit('data', 'Error: missing API_KEY\n')
    proc.emit('exit', 1, null)

    await expect(connecting).rejects.toThrow(/exited with code 1.*missing API_KEY/)
    expect(t.isConnected()).toBe(false)
  })

  it('kills the child process when initialize fails', async () => {
    const t = makeTransport()
    const connecting = t.connect()
    const proc = await waitForSpawn()

    proc.stdout.emit(
      'data',
      line({ jsonrpc: '2.0', id: '1', error: { code: -32600, message: 'bad init' } }),
    )

    await expect(connecting).rejects.toThrow('bad init')
    expect(proc.kill).toHaveBeenCalled()
    expect(t.isConnected()).toBe(false)
  })

  it('does not kill the child process when initialize succeeds', async () => {
    const t = makeTransport()
    const proc = await connectReady(t)

    expect(proc.kill).not.toHaveBeenCalled()
    expect(t.isConnected()).toBe(true)
  })

  it('rejects in-flight tool calls when the process crashes', async () => {
    const t = makeTransport(60_000)
    const proc = await connectReady(t)

    const call = t.callTool('slow', {})
    proc.emit('exit', null, 'SIGSEGV')

    await expect(call).rejects.toThrow(/killed by signal SIGSEGV/)
    expect(t.isConnected()).toBe(false)
    await expect(t.listTools()).rejects.toThrow(/not running/)
  })

  it('rejects in-flight requests on disconnect', async () => {
    const t = makeTransport(60_000)
    const proc = await connectReady(t)

    const call = t.callTool('slow', {})
    t.disconnect()

    await expect(call).rejects.toThrow(/disconnected/)
    expect(proc.kill).toHaveBeenCalled()
  })

  it('ignores exit events from a process that was already replaced', async () => {
    const t = makeTransport(60_000)
    const oldProc = await connectReady(t)
    t.disconnect()

    const newProc = await (async () => {
      const connecting = t.connect()
      await vi.waitFor(() => expect(h.procs.length).toBe(2))
      const p = h.procs[1]
      p.stdout.emit('data', line({ jsonrpc: '2.0', id: '2', result: INIT_RESULT }))
      await connecting
      return p
    })()

    oldProc.emit('exit', 0, null)
    expect(t.isConnected()).toBe(true)
    expect(newProc.kill).not.toHaveBeenCalled()
  })

  it('clears the per-request timeout timer once the response arrives', async () => {
    const t = makeTransport(60_000)
    const proc = await connectReady(t)

    vi.useFakeTimers()
    const listing = t.listTools()
    expect(vi.getTimerCount()).toBe(1)
    proc.stdout.emit('data', line({ jsonrpc: '2.0', id: '2', result: { tools: [] } }))
    await listing
    expect(vi.getTimerCount()).toBe(0)
  })
})
