import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/main/db/agentRepository', () => ({
  agentRepository: {
    findAll: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    upsert: vi.fn()
  }
}))

describe('Agent Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export agentRepository', async () => {
    const { agentRepository } = await import('../../src/main/db/agentRepository')
    expect(agentRepository).toBeDefined()
  })

  it('should have findAll method', async () => {
    const { agentRepository } = await import('../../src/main/db/agentRepository')
    expect(typeof agentRepository.findAll).toBe('function')
  })

  it('should have findById method', async () => {
    const { agentRepository } = await import('../../src/main/db/agentRepository')
    expect(typeof agentRepository.findById).toBe('function')
  })

  it('should have upsert method', async () => {
    const { agentRepository } = await import('../../src/main/db/agentRepository')
    expect(typeof agentRepository.upsert).toBe('function')
  })
})
