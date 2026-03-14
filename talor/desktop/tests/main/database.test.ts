import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test')
  }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn()
  }
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([])
    }),
    close: vi.fn()
  }))
}))

describe('Database', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize database', async () => {
    const { initDatabase } = await import('../../src/main/db/database')
    const db = initDatabase()
    expect(db).toBeDefined()
  })
})
