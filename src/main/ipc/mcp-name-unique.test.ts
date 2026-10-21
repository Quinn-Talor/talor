import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, repo, registry } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  repo: {
    getByName: vi.fn(),
    create: vi.fn((p: { name: string }) => ({ id: 'new', enabled: true, ...p })),
    update: vi.fn((id: string, p: object) => ({ id, enabled: true, ...p })),
    getById: vi.fn(() => null),
  },
  registry: { getConnectedServers: vi.fn(() => []), connectServer: vi.fn() },
}))

vi.mock('electron', () => ({ ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) } }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: repo }))
vi.mock('../mcp/client', () => ({ mcpRegistry: registry }))

import { registerMCPHandlers } from './mcp'

function handler(channel: string) {
  return mockHandle.mock.calls.find((c) => c[0] === channel)![1] as (
    ...a: unknown[]
  ) => Promise<unknown>
}

describe('MCP server names are unique', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    repo.getByName.mockReset()
    repo.create.mockClear()
    repo.update.mockClear()
    registerMCPHandlers()
  })

  it('create rejects a name that is already taken', async () => {
    repo.getByName.mockReturnValue({ id: 'other', name: 'fs' })
    await expect(
      handler('mcp:servers:create')(null, { name: 'fs', type: 'stdio', command: 'x' }),
    ).rejects.toThrow('already exists')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('create accepts a new name', async () => {
    repo.getByName.mockReturnValue(null)
    await handler('mcp:servers:create')(null, { name: 'fs', type: 'stdio', command: 'x' })
    expect(repo.create).toHaveBeenCalled()
  })

  it('update may keep its own name but not take another server name', async () => {
    repo.getByName.mockReturnValue({ id: 'self', name: 'fs' })
    await handler('mcp:servers:update')(null, 'self', { name: 'fs' })
    expect(repo.update).toHaveBeenCalledTimes(1)

    repo.getByName.mockReturnValue({ id: 'other', name: 'git' })
    await expect(handler('mcp:servers:update')(null, 'self', { name: 'git' })).rejects.toThrow(
      'already exists',
    )
    expect(repo.update).toHaveBeenCalledTimes(1)
  })
})
