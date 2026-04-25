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
import { HttpTransport } from './http'
import { spawn } from 'child_process'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('AC-006-02: Connection Status', () => {
  describe('StdioTransport connection state', () => {
    let transport: StdioTransport

    beforeEach(() => {
      vi.clearAllMocks()
      transport = new StdioTransport({
        id: 'conn-server',
        name: 'Conn Server',
        type: 'stdio',
        command: 'echo',
        args: [],
        enabled: true,
      })
    })

    it('isConnected returns false before connect', () => {
      expect(transport.isConnected()).toBe(false)
    })

    it('isConnected returns true after successful connect', async () => {
      await transport.connect()
      expect(transport.isConnected()).toBe(true)
    })

    it('isConnected returns false after disconnect', async () => {
      await transport.connect()
      transport.disconnect()
      expect(transport.isConnected()).toBe(false)
    })

    it('disconnect kills the child process', async () => {
      await transport.connect()
      const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value
      transport.disconnect()
      expect(mockProcess.kill).toHaveBeenCalled()
    })
  })

  describe('HttpTransport connection state', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockFetch.mockReset()
      mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string)
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'http-test', version: '1.0' },
              capabilities: { tools: true },
            },
          }),
        }
      })
    })

    it('isConnected returns false before connect', () => {
      const transport = new HttpTransport({
        id: 'http-conn',
        name: 'HTTP Conn',
        type: 'http',
        url: 'https://mcp.example.com/api',
        enabled: true,
      })
      expect(transport.isConnected()).toBe(false)
    })

    it('isConnected returns true after successful connect', async () => {
      const transport = new HttpTransport({
        id: 'http-conn',
        name: 'HTTP Conn',
        type: 'http',
        url: 'https://mcp.example.com/api',
        enabled: true,
      })
      await transport.connect()
      expect(transport.isConnected()).toBe(true)
    })

    it('isConnected returns false after disconnect', async () => {
      const transport = new HttpTransport({
        id: 'http-conn',
        name: 'HTTP Conn',
        type: 'http',
        url: 'https://mcp.example.com/api',
        enabled: true,
      })
      await transport.connect()
      transport.disconnect()
      expect(transport.isConnected()).toBe(false)
    })

    it('rejects connect when URL is not configured', async () => {
      const transport = new HttpTransport({
        id: 'no-url',
        name: 'No URL',
        type: 'http',
        enabled: true,
      })
      await expect(transport.connect()).rejects.toThrow('HTTP transport requires URL')
    })
  })

  describe('StdioTransport rejects when command is missing', () => {
    it('throws when command is not configured', async () => {
      const transport = new StdioTransport({
        id: 'no-cmd',
        name: 'No Command',
        type: 'stdio',
        enabled: true,
      })
      await expect(transport.connect()).rejects.toThrow('STDIO transport requires command')
    })
  })
})
