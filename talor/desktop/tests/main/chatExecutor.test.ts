import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/main/db/sessionRepository', () => ({
  sessionRepository: {
    findAll: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addMessage: vi.fn()
  }
}))

vi.mock('../../src/main/db/providerRepository', () => ({
  providerRepository: {
    findAll: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    upsert: vi.fn()
  }
}))

vi.mock('../../src/main/db/agentRepository', () => ({
  agentRepository: {
    findAll: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    upsert: vi.fn()
  }
}))

describe('Chat Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export createChatExecutor function', async () => {
    const { createChatExecutor } = await import('../../src/main/chatExecutor')
    expect(createChatExecutor).toBeDefined()
    expect(typeof createChatExecutor).toBe('function')
  })

  it('should have execute method', async () => {
    const { createChatExecutor } = await import('../../src/main/chatExecutor')
    const executor = createChatExecutor()
    expect(typeof executor.execute).toBe('function')
  })
})
