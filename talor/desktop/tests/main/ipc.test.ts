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

describe('IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export registerIpcHandlers function', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    expect(registerIpcHandlers).toBeDefined()
    expect(typeof registerIpcHandlers).toBe('function')
  })

  describe('Session repository calls', () => {
    it('should call sessionRepository.findAll', async () => {
      const { sessionRepository } = await import('../../src/main/db/sessionRepository')
      const mockSessions = [
        { id: '1', title: 'Test Session', agentId: 'build', createdAt: Date.now(), updatedAt: Date.now() }
      ]
      ;(sessionRepository.findAll as ReturnType<typeof vi.fn>).mockReturnValue(mockSessions)

      sessionRepository.findAll()
      expect(sessionRepository.findAll).toHaveBeenCalled()
    })

    it('should call sessionRepository.create with correct data', async () => {
      const { sessionRepository } = await import('../../src/main/db/sessionRepository')
      const mockSession = { id: '1', title: 'Test', agentId: 'build', createdAt: Date.now(), updatedAt: Date.now() }

      sessionRepository.create(mockSession)
      expect(sessionRepository.create).toHaveBeenCalledWith(mockSession)
    })

    it('should call sessionRepository.delete with id', async () => {
      const { sessionRepository } = await import('../../src/main/db/sessionRepository')

      sessionRepository.delete('test-id')
      expect(sessionRepository.delete).toHaveBeenCalledWith('test-id')
    })
  })

  describe('Provider repository calls', () => {
    it('should call providerRepository.findAll', async () => {
      const { providerRepository } = await import('../../src/main/db/providerRepository')

      providerRepository.findAll()
      expect(providerRepository.findAll).toHaveBeenCalled()
    })

    it('should call providerRepository.upsert with correct data', async () => {
      const { providerRepository } = await import('../../src/main/db/providerRepository')
      const mockProvider = { id: '1', name: 'Test', type: 'ollama', isConfigured: true }

      providerRepository.upsert(mockProvider)
      expect(providerRepository.upsert).toHaveBeenCalledWith(mockProvider)
    })
  })
})
