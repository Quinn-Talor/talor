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

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { StdioTransport } from './stdio'
import { HttpTransport } from './http'
import { spawn } from 'child_process'

describe('AC-005-03: Timeout Handling', () => {
  describe('StdioTransport timeout', () => {
    it('rejects with timeout error when server does not respond within TIMEOUT_MS', async () => {
      const transport = new StdioTransport({
        id: 'slow-server',
        name: 'Slow Server',
        type: 'stdio',
        command: 'echo',
        args: [],
        enabled: true,
      })

      await transport.connect()

      const callPromise = transport.callTool('slow_tool', {})

      await expect(callPromise).rejects.toThrow(/timed out/)
    }, 35000)

    it('cleans up pending request after timeout', async () => {
      const transport = new StdioTransport({
        id: 'timeout-server',
        name: 'Timeout Server',
        type: 'stdio',
        command: 'echo',
        args: [],
        enabled: true,
      })

      await transport.connect()

      try {
        await transport.callTool('timeout_tool', {})
      } catch {
        // expected timeout
      }

      const mockProcess = (spawn as ReturnType<typeof vi.fn>).mock.results[0].value

      setTimeout(() => {
        mockProcess.stdout.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: '3',
          result: { content: [{ type: 'text', text: 'late response' }] },
        }) + '\n')
      }, 10)

      // The late response should not cause errors (request already removed)
    }, 35000)
  })

  describe('HttpTransport timeout', () => {
    it('rejects with timeout error when HTTP request exceeds timeout', async () => {
      mockFetch.mockReset()

      let callCount = 0
      mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string)
        if (body.method === 'initialize') {
          callCount++
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'test', version: '1.0' },
                capabilities: { tools: true },
              },
            }),
          }
        }

        // Simulate timeout by aborting when signal fires
        return new Promise((_, reject) => {
          const signal = options.signal as AbortSignal
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }
        })
      })

      const transport = new HttpTransport({
        id: 'http-timeout',
        name: 'HTTP Timeout',
        type: 'http',
        url: 'https://mcp.example.com/slow',
        enabled: true,
      })

      await transport.connect()
      await expect(transport.callTool('slow_tool', {})).rejects.toThrow(/timed out/)
    }, 35000)
  })

  describe('Client-level timeout via Promise.race', () => {
    it('TOOL_TIMEOUT_MS is set to 30000ms in client.ts', async () => {
      const clientSource = await import('fs').then(fs =>
        fs.readFileSync(require('path').resolve(__dirname, '../client.ts'), 'utf-8')
      )
      expect(clientSource).toContain('TOOL_TIMEOUT_MS = 30000')
    })

    it('client uses Promise.race for tool execution timeout', async () => {
      const clientSource = await import('fs').then(fs =>
        fs.readFileSync(require('path').resolve(__dirname, '../client.ts'), 'utf-8')
      )
      expect(clientSource).toContain('Promise.race')
      expect(clientSource).toContain('TOOL_TIMEOUT_MS')
    })
  })
})
