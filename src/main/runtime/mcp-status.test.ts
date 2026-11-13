// MCP 状态与测试连接走引擎连接池（D2 AC-004、AC-005）。

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
const { engine } = vi.hoisted(() => ({
  engine: { runtimeCreated: vi.fn(() => false), getRuntime: vi.fn() },
}))
vi.mock('./engine', () => engine)
vi.mock('../repos/mcp-server-repo', () => ({
  mcpServerRepo: { list: () => [], getById: () => null },
}))
vi.mock('../accounts/account-store', () => ({ AccountStore: { getInstance: () => null } }))

import {
  createMcpHost,
  type McpConnect,
  type McpHost,
  type McpServerSpec,
  type Vault,
} from '@talor/agent-engine'
import { fakeMcpServer } from '@talor/agent-engine/testing'
import type { MCPServer } from '../repos/mcp-server-repo'
import type { Runtime } from './engine'
import { mcpServerTools, testMcpConnection } from './mcp-status'

const AT = '2026-01-01T00:00:00.000Z'
const server = (id: string, command: string, enabled = true): MCPServer => ({
  id,
  name: `srv-${id}`,
  type: 'stdio',
  command,
  enabled,
  created_at: AT,
  updated_at: AT,
})
const SERVERS = [server('a', 'ok'), server('b', 'broken'), server('c', 'ok', false)]

function fakePool() {
  const released: string[] = []
  const pool = {
    acquire: vi.fn(async (spec: McpServerSpec, _opts: { vault: Vault; signal: AbortSignal }) => {
      const command = (spec.transport as { command: string }).command
      if (command === 'broken') throw new Error('spawn failed')
      return {
        tools: [
          { name: 'x', inputSchema: { type: 'object' } },
          { name: 'y', inputSchema: { type: 'object' } },
        ],
        version: 1,
        call: vi.fn(),
        available: () => true,
        release: () => released.push(spec.name),
      }
    }),
  }
  return { pool, released }
}

beforeEach(() => {
  engine.runtimeCreated.mockReset().mockReturnValue(false)
  engine.getRuntime.mockReset()
})

describe('mcpServerTools', () => {
  it('AC-004 reads each enabled server from the pool and releases every lease', async () => {
    const { pool, released } = fakePool()
    const runtime = { mcp: pool as unknown as McpHost, vault: {} as Vault } as unknown as Runtime

    const result = await mcpServerTools({ runtime: () => runtime, servers: () => SERVERS })

    expect(result.map((r) => [r.serverId, r.name, r.connected, r.tools.length])).toEqual([
      ['a', 'srv-a', true, 2],
      ['b', 'srv-b', false, 0],
      ['c', 'srv-c', false, 0],
    ])
    expect(pool.acquire).toHaveBeenCalledTimes(2)
    const opts = pool.acquire.mock.calls[0]![1]
    expect(opts.vault).toBe(runtime.vault)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(released).toHaveLength(1)
  })

  it('AC-004 reports every server disconnected without creating the runtime', async () => {
    const result = await mcpServerTools({ servers: () => SERVERS })
    expect(result.every((r) => !r.connected && r.tools.length === 0)).toBe(true)
    expect(result).toHaveLength(3)
    expect(engine.getRuntime).not.toHaveBeenCalled()
  })
})

describe('testMcpConnection', () => {
  function hostWith(connect: McpConnect) {
    const shutdown = vi.fn()
    const host = (vault: Vault): McpHost => {
      const h = createMcpHost({ connect, vault })
      const original = h.shutdown.bind(h)
      h.shutdown = async () => {
        shutdown()
        await original()
      }
      return h
    }
    return { host, shutdown }
  }

  const FORM = {
    type: 'http' as const,
    url: 'https://mcp.example.com/mcp',
    auth: { type: 'bearer' as const, token: 't0k' },
  }

  it('AC-005 connects with the unsaved bearer token and counts the tools', async () => {
    const fake = fakeMcpServer({ tools: [{ name: 'a' }, { name: 'b' }] })
    const { host, shutdown } = hostWith(fake.connect)

    const result = await testMcpConnection(FORM, { host })

    expect(result).toMatchObject({
      status: 'success',
      tools_count: 2,
      message: '✅ 连接成功，发现 2 个工具',
    })
    expect(typeof result.latency_ms).toBe('number')
    expect(fake.connects[0]!.transport).toMatchObject({
      kind: 'http',
      url: FORM.url,
      headers: { Authorization: 'Bearer t0k' },
    })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('AC-005 reports TIMEOUT when the connection does not finish in time', async () => {
    const hang: McpConnect = (_server, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const { host, shutdown } = hostWith(hang)

    const result = await testMcpConnection(FORM, { host, timeoutMs: 50 })

    expect(result).toMatchObject({ status: 'failure', error_code: 'TIMEOUT' })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('AC-005 reports CONNECTION_FAILED with the error message', async () => {
    const fail: McpConnect = async () => {
      throw new Error('HTTP 406: Not Acceptable')
    }
    const { host, shutdown } = hostWith(fail)

    const result = await testMcpConnection({ type: 'stdio', command: 'node' }, { host })

    expect(result).toMatchObject({ status: 'failure', error_code: 'CONNECTION_FAILED' })
    expect(result.message).toContain('HTTP 406')
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('returns INVALID_CONFIG without building a pool when url/command is missing', async () => {
    const host = vi.fn()
    expect(await testMcpConnection({ type: 'http' }, { host })).toMatchObject({
      status: 'failure',
      error_code: 'INVALID_CONFIG',
    })
    expect(host).not.toHaveBeenCalled()
  })
})
