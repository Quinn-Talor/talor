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

describe('AC-006-01: Tool Listing', () => {
  let transport: StdioTransport

  beforeEach(() => {
    vi.clearAllMocks()
    transport = new StdioTransport({
      id: 'tool-list-server',
      name: 'Tool List Server',
      type: 'stdio',
      command: 'echo',
      args: [],
      enabled: true,
    })
  })

  it('sends tools/list JSON-RPC request and returns tool array', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

    const listPromise = transport.listTools()

    setTimeout(() => {
      mockProcess.stdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        result: {
          tools: [
            { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
            { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
          ],
        },
      }) + '\n')
    }, 10)

    const tools = await listPromise

    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe('read_file')
    expect(tools[0].description).toBe('Read a file')
    expect(tools[1].name).toBe('write_file')
  })

  it('returns empty array when server has no tools', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

    const listPromise = transport.listTools()

    setTimeout(() => {
      mockProcess.stdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        result: { tools: [] },
      }) + '\n')
    }, 10)

    const tools = await listPromise
    expect(tools).toEqual([])
  })

  it('handles missing tools field in response gracefully', async () => {
    await transport.connect()

    const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

    const listPromise = transport.listTools()

    setTimeout(() => {
      mockProcess.stdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        result: {},
      }) + '\n')
    }, 10)

    const tools = await listPromise
    expect(tools).toEqual([])
  })
})
