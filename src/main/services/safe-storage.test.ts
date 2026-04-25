import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => Buffer.from('{}')),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { safeStorage } from 'electron'
import { SafeStorageService } from './safe-storage'

describe('SafeStorageService.setApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset singleton for each test
    ;(SafeStorageService as unknown as { instance: null }).instance = null
  })

  it('returns true when encryption is available and key is saved', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const service = SafeStorageService.getInstance()
    const result = service.setApiKey('provider-1', 'sk-test')
    expect(result).toBe(true)
  })

  it('returns false when encryption is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    const service = SafeStorageService.getInstance()
    const result = service.setApiKey('provider-1', 'sk-test')
    expect(result).toBe(false)
  })
})
