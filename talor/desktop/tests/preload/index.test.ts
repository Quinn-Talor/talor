import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockApi = {
  invoke: vi.fn(),
  on: vi.fn().mockReturnValue(() => {}),
  off: vi.fn()
}

vi.stubGlobal('window', {
  api: mockApi
})

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  },
  contextBridge: {
    exposeInMainWorld: vi.fn()
  }
}))

describe('Preload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be importable', async () => {
    await expect(import('../../src/preload/index')).resolves.toBeDefined()
  })
})
