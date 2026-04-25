import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args),
  },
}))

describe('registerMCPHandlers', () => {
  beforeEach(() => {
    mockHandle.mockClear()
  })

  it('registers all MCP IPC handlers', async () => {
    vi.resetModules()
    const { registerMCPHandlers } = await import('./mcp')
    registerMCPHandlers()
    const registeredChannels = mockHandle.mock.calls.map((call) => call[0])
    expect(registeredChannels).toContain('mcp:servers:list')
    expect(registeredChannels).toContain('mcp:servers:create')
    expect(registeredChannels).toContain('mcp:servers:get')
    expect(registeredChannels).toContain('mcp:servers:update')
    expect(registeredChannels).toContain('mcp:servers:delete')
    expect(registeredChannels).toContain('mcp:servers:setEnabled')
    expect(registeredChannels).toContain('mcp:servers:importConfig')
    expect(registeredChannels).toContain('mcp:servers:exportConfig')
  })
})
