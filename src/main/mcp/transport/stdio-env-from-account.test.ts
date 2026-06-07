// stdio envFromAccount 注入测试
//
// 验证 StdioTransport.connect() 时调用 AccountStore.resolveAccountVars,
// 将凭据注入子进程 env 而不经过 LLM / 渲染端。

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// 单 spawn mock,确保 initialize 不阻塞
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
        proc.stdout.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'test', version: '1.0' },
              capabilities: { tools: true },
            },
          }) + '\n',
        )
      }, 5)
      return proc
    }),
  }
})

// AccountStore 用 mock 模拟单例
const mockResolveAccountVars = vi.fn()
vi.mock('../../accounts/account-store', () => ({
  AccountStore: {
    getInstance: () => ({
      resolveAccountVars: mockResolveAccountVars,
    }),
  },
}))

import { StdioTransport } from './stdio'
import { spawn } from 'child_process'

describe('StdioTransport envFromAccount injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAccountVars.mockReset()
  })

  it('injects resolved envFromAccount values into spawn env', async () => {
    mockResolveAccountVars.mockReturnValue({
      resolved: { GITHUB_TOKEN: 'ghp_real_value' },
      missing: [],
    })

    const transport = new StdioTransport({
      id: 'github',
      name: 'GitHub MCP',
      type: 'stdio',
      command: 'echo',
      envFromAccount: { GITHUB_TOKEN: 'GITHUB_PAT' },
      enabled: true,
    })
    await transport.connect()

    expect(mockResolveAccountVars).toHaveBeenCalledWith({ GITHUB_TOKEN: 'GITHUB_PAT' })

    const spawnMock = spawn as ReturnType<typeof vi.fn>
    const spawnEnv = spawnMock.mock.calls[0][2].env as Record<string, string>
    expect(spawnEnv.GITHUB_TOKEN).toBe('ghp_real_value')
  })

  it('envFromAccount overrides literal env on same key', async () => {
    mockResolveAccountVars.mockReturnValue({
      resolved: { GITHUB_TOKEN: 'ghp_secret' },
      missing: [],
    })

    const transport = new StdioTransport({
      id: 'github',
      name: 'GitHub MCP',
      type: 'stdio',
      command: 'echo',
      env: { GITHUB_TOKEN: 'oops_literal' }, // 字面值不应胜出
      envFromAccount: { GITHUB_TOKEN: 'GITHUB_PAT' },
      enabled: true,
    })
    await transport.connect()

    const spawnMock = spawn as ReturnType<typeof vi.fn>
    const spawnEnv = spawnMock.mock.calls[0][2].env as Record<string, string>
    expect(spawnEnv.GITHUB_TOKEN).toBe('ghp_secret')
  })

  it('missing envVar logs warn but does not block startup', async () => {
    mockResolveAccountVars.mockReturnValue({
      resolved: {},
      missing: ['GITHUB_PAT'],
    })

    const transport = new StdioTransport({
      id: 'github',
      name: 'GitHub MCP',
      type: 'stdio',
      command: 'echo',
      envFromAccount: { GITHUB_TOKEN: 'GITHUB_PAT' },
      enabled: true,
    })

    await expect(transport.connect()).resolves.toBeUndefined()

    const spawnMock = spawn as ReturnType<typeof vi.fn>
    const spawnEnv = spawnMock.mock.calls[0][2].env as Record<string, string>
    expect(spawnEnv.GITHUB_TOKEN).toBeUndefined()
  })

  it('no envFromAccount → resolveAccountVars not called', async () => {
    const transport = new StdioTransport({
      id: 'simple',
      name: 'Simple MCP',
      type: 'stdio',
      command: 'echo',
      env: { LOG_LEVEL: 'debug' },
      enabled: true,
    })
    await transport.connect()

    expect(mockResolveAccountVars).not.toHaveBeenCalled()

    const spawnMock = spawn as ReturnType<typeof vi.fn>
    const spawnEnv = spawnMock.mock.calls[0][2].env as Record<string, string>
    expect(spawnEnv.LOG_LEVEL).toBe('debug')
  })
})
