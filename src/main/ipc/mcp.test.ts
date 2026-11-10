import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, status, repo } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  status: {
    mcpServerTools: vi.fn(),
    testMcpConnection: vi.fn(),
  },
  repo: {
    list: vi.fn(() => []),
    getById: vi.fn(),
    getByName: vi.fn(() => null),
    create: vi.fn((input: Record<string, unknown>) => ({ id: 'new', ...input })),
    update: vi.fn((id: string) => ({ id })),
    delete: vi.fn(),
    setEnabled: vi.fn((id: string, enabled: boolean) => ({ id, enabled })),
    upsertFromConfig: vi.fn((name: string) => ({ id: name })),
  },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args),
  },
}))
vi.mock('../runtime/mcp-status', () => status)
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: repo }))

import { registerMCPHandlers } from './mcp'

function handler(channel: string): (...args: unknown[]) => unknown {
  const entry = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!entry) throw new Error(`handler not registered: ${channel}`)
  return entry[1] as (...args: unknown[]) => unknown
}

beforeEach(() => {
  mockHandle.mockClear()
  for (const fn of [...Object.values(status), ...Object.values(repo)]) fn.mockClear()
  registerMCPHandlers()
})

describe('registerMCPHandlers', () => {
  it('AC-006 registers the settings channels and none of the legacy pool channels', () => {
    const channels = mockHandle.mock.calls.map((call) => call[0])
    expect(channels.sort()).toEqual(
      [
        'mcp:servers:list',
        'mcp:servers:create',
        'mcp:servers:get',
        'mcp:servers:update',
        'mcp:servers:delete',
        'mcp:servers:setEnabled',
        'mcp:servers:importConfig',
        'mcp:servers:exportConfig',
        'mcp:servers:testConnection',
        'mcp:servers:status',
      ].sort(),
    )
    for (const legacy of [
      'mcp:connect',
      'mcp:disconnect',
      'mcp:tools:list',
      'mcp:servers:connected',
    ]) {
      expect(channels).not.toContain(legacy)
    }
  })

  it('AC-006 create / update / delete / setEnabled only write the repo', async () => {
    await handler('mcp:servers:create')({}, { name: 'fs', type: 'stdio', command: 'npx' })
    await handler('mcp:servers:update')({}, 'new', { command: 'node' })
    await handler('mcp:servers:setEnabled')({}, 'new', false)
    await handler('mcp:servers:delete')({}, 'new')

    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.update).toHaveBeenCalledWith('new', { command: 'node' })
    expect(repo.setEnabled).toHaveBeenCalledWith('new', false)
    expect(repo.delete).toHaveBeenCalledWith('new')
    expect(status.mcpServerTools).not.toHaveBeenCalled()
    expect(status.testMcpConnection).not.toHaveBeenCalled()
  })

  it('AC-006 status maps the engine pool view to tool counts', async () => {
    status.mcpServerTools.mockResolvedValue([
      { serverId: 'a', name: 'alpha', connected: true, tools: [{ name: 'x' }, { name: 'y' }] },
      { serverId: 'b', name: 'beta', connected: false, tools: [] },
    ])
    expect(await handler('mcp:servers:status')({})).toEqual([
      { serverId: 'a', name: 'alpha', connected: true, toolCount: 2 },
      { serverId: 'b', name: 'beta', connected: false, toolCount: 0 },
    ])
  })

  it('AC-006 testConnection hands the form to testMcpConnection', async () => {
    status.testMcpConnection.mockResolvedValue({ status: 'success', tools_count: 1 })
    const form = { type: 'http', url: 'https://mcp.example.com/mcp' }
    expect(await handler('mcp:servers:testConnection')({}, form)).toEqual({
      status: 'success',
      tools_count: 1,
    })
    expect(status.testMcpConnection).toHaveBeenCalledWith(form)
  })
})
