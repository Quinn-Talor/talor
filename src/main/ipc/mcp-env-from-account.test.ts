// MCP IPC 带上账户凭据引用 envFromAccount：创建、更新、导入、导出、测试连接（修 T2）。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, repo, status } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  repo: {
    getByName: vi.fn(() => null),
    create: vi.fn((p: { name: string }) => ({ id: 'new', enabled: true, ...p })),
    update: vi.fn((id: string, p: object) => ({ id, enabled: true, ...p })),
    upsertFromConfig: vi.fn((name: string) => ({ id: `id-${name}`, name, enabled: true })),
    getById: vi.fn(() => null),
    list: vi.fn(() => [] as object[]),
  },
  status: { mcpServerTools: vi.fn(), testMcpConnection: vi.fn() },
}))

vi.mock('electron', () => ({ ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) } }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: repo }))
vi.mock('../runtime/mcp-status', () => status)

import { registerMCPHandlers } from './mcp'

function handler(channel: string) {
  return mockHandle.mock.calls.find((c) => c[0] === channel)![1] as (
    ...a: unknown[]
  ) => Promise<unknown>
}

const REFS = { GH_TOKEN: 'github_pat' }

describe('MCP IPC carries envFromAccount', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    repo.create.mockClear()
    repo.update.mockClear()
    repo.upsertFromConfig.mockClear()
    status.testMcpConnection.mockClear()
    registerMCPHandlers()
  })

  it('AC-004 create and update hand the references to the repo', async () => {
    await handler('mcp:servers:create')(null, {
      name: 'gh',
      type: 'stdio',
      command: 'npx',
      envFromAccount: REFS,
    })
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ envFromAccount: REFS }))

    await handler('mcp:servers:update')(null, 'id1', { envFromAccount: REFS })
    expect(repo.update).toHaveBeenCalledWith('id1', { envFromAccount: REFS })
  })

  it('AC-004 import and export keep the references', async () => {
    await handler('mcp:servers:importConfig')(
      null,
      JSON.stringify({ gh: { type: 'stdio', command: 'npx', envFromAccount: REFS } }),
    )
    expect(repo.upsertFromConfig).toHaveBeenCalledWith(
      'gh',
      expect.objectContaining({ envFromAccount: REFS }),
    )

    repo.list.mockReturnValueOnce([
      { id: 'a', name: 'gh', type: 'stdio', command: 'npx', envFromAccount: REFS },
      { id: 'b', name: 'fs', type: 'stdio', command: 'npx' },
    ])
    const exported = JSON.parse((await handler('mcp:servers:exportConfig')(null)) as string)
    // B1 起导出为 .mcp.json：账户凭据引用写成 env 里的 `${<账户 key>}`
    expect(exported.mcpServers.gh.env).toEqual({ GH_TOKEN: '${github_pat}' })
    expect(exported.mcpServers.fs).not.toHaveProperty('env')
  })

  it('AC-004 tests a connection with the references', async () => {
    await handler('mcp:servers:testConnection')(null, {
      type: 'stdio',
      command: 'npx',
      envFromAccount: REFS,
    })
    expect(status.testMcpConnection).toHaveBeenCalledWith(
      expect.objectContaining({ envFromAccount: REFS }),
    )
  })
})
