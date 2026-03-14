import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn()
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    webContents: {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn()
    },
    on: vi.fn(),
    close: vi.fn(),
    show: vi.fn()
  })),
  ipcMain: {
    handle: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: {
    setAppUserModelId: vi.fn()
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  is: {
    dev: false
  }
}))

describe('Main Process', () => {
  it('should be importable without errors', async () => {
    await expect(import('../../src/main/index')).resolves.toBeDefined()
  })
})
