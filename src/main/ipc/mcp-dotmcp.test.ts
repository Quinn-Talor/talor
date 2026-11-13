// MCP 配置导入导出改用 .mcp.json 格式；旧格式仍能导入（B1 AC-013、AC-014）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, repo, status } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  repo: {
    getByName: vi.fn(() => null),
    upsertFromConfig: vi.fn((name: string, _row: unknown) => ({
      id: `id-${name}`,
      name,
      enabled: true,
    })),
    getById: vi.fn(() => null),
    list: vi.fn(() => [] as object[]),
  },
  status: { mcpServerTools: vi.fn(), testMcpConnection: vi.fn() },
}))

vi.mock('electron', () => ({ ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) } }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: repo }))
vi.mock('../runtime/mcp-status', () => status)

import { parseMcpConfig } from '@talor/agent-engine'
import { registerMCPHandlers } from './mcp'

function handler(channel: string) {
  return mockHandle.mock.calls.find((c) => c[0] === channel)![1] as (
    ...a: unknown[]
  ) => Promise<unknown>
}

type ImportResult = Array<{ name: string; status: string; warnings?: string[] }>

describe('.mcp.json import and export', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    repo.upsertFromConfig.mockClear()
    registerMCPHandlers()
  })

  it('B1 AC-013 imports .mcp.json servers with warnings for what cannot be kept', async () => {
    const results = (await handler('mcp:servers:importConfig')(
      null,
      JSON.stringify({
        mcpServers: {
          gh: {
            command: 'gh-mcp',
            args: ['--stdio'],
            env: { A: '1', GITHUB_TOKEN: '${GITHUB_TOKEN}', B: 'pre ${X}' },
            cwd: '/tmp',
          },
          remote: {
            type: 'http',
            url: 'https://r.example.com',
            headers: { Authorization: 'Bearer abc', 'X-Other': 'v' },
          },
          keyed: { type: 'http', url: 'https://k.example.com', headers: { 'X-API-Key': 'k' } },
          envtok: {
            type: 'http',
            url: 'https://e.example.com',
            headers: { Authorization: 'Bearer ${TOK}' },
          },
        },
      }),
    )) as ImportResult

    const rows = new Map(repo.upsertFromConfig.mock.calls.map((c) => [c[0], c[1]]))
    expect(rows.get('gh')).toEqual({
      type: 'stdio',
      command: 'gh-mcp',
      args: ['--stdio'],
      env: { A: '1', B: 'pre ${X}' },
      envFromAccount: { GITHUB_TOKEN: 'GITHUB_TOKEN' },
    })
    expect(rows.get('remote')).toEqual({
      type: 'http',
      url: 'https://r.example.com',
      auth: { type: 'bearer', token: 'abc' },
    })
    expect(rows.get('keyed')).toEqual({
      type: 'http',
      url: 'https://k.example.com',
      auth: { type: 'apiKey', apiKey: 'k' },
    })
    expect(rows.get('envtok')).toEqual({ type: 'http', url: 'https://e.example.com' })

    const warnings = new Map(results.map((r) => [r.name, (r.warnings ?? []).join('\n')]))
    expect(warnings.get('gh')).toContain('env.B')
    expect(warnings.get('gh')).toContain('cwd')
    expect(warnings.get('gh')).toContain('GITHUB_TOKEN')
    expect(warnings.get('gh')).toContain('进程环境变量')
    expect(warnings.get('remote')).toContain('X-Other')
    expect(warnings.get('keyed')).toBe('')
    expect(warnings.get('envtok')).toContain('Authorization')
  })

  it('B1 AC-013 still imports the old format and rejects a config it cannot parse as a whole', async () => {
    await handler('mcp:servers:importConfig')(
      null,
      JSON.stringify({ fs: { type: 'stdio', command: 'npx', args: ['fs'] } }),
    )
    expect(repo.upsertFromConfig).toHaveBeenCalledWith('fs', {
      type: 'stdio',
      command: 'npx',
      args: ['fs'],
    })

    repo.upsertFromConfig.mockClear()
    await expect(
      handler('mcp:servers:importConfig')(
        null,
        JSON.stringify({
          mcpServers: {
            ok: { command: 'ok' },
            old: { type: 'sse', url: 'https://sse.example.com' },
          },
        }),
      ),
    ).rejects.toThrow('SSE')
    expect(repo.upsertFromConfig).not.toHaveBeenCalled()
  })

  it('B1 AC-014 exports .mcp.json that parses back', async () => {
    repo.list.mockReturnValueOnce([
      {
        id: 'a',
        name: 'gh',
        type: 'stdio',
        command: 'gh-mcp',
        args: ['--stdio'],
        env: { A: '1', B: 'pre ${X}' },
        envFromAccount: { GITHUB_TOKEN: 'GITHUB_TOKEN' },
        enabled: true,
      },
      {
        id: 'b',
        name: 'remote',
        type: 'http',
        url: 'https://r.example.com',
        auth: { type: 'bearer', token: 'abc' },
        enabled: true,
      },
      {
        id: 'c',
        name: 'keyed',
        type: 'http',
        url: 'https://k.example.com',
        auth: { type: 'apiKey', apiKey: 'k' },
        enabled: false,
      },
    ])
    const text = (await handler('mcp:servers:exportConfig')(null)) as string
    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        gh: {
          command: 'gh-mcp',
          args: ['--stdio'],
          env: { A: '1', B: 'pre ${X}', GITHUB_TOKEN: '${GITHUB_TOKEN}' },
        },
        remote: {
          type: 'http',
          url: 'https://r.example.com',
          headers: { Authorization: 'Bearer abc' },
        },
        keyed: { type: 'http', url: 'https://k.example.com', headers: { 'X-API-Key': 'k' } },
      },
    })
    expect(() => parseMcpConfig(text)).not.toThrow()
  })
})
