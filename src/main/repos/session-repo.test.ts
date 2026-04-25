import { describe, it, expect, vi } from 'vitest'

const mockMessages: Array<{ id: string; session_id: string; role: string; content: string; created_at: string }> = []
const mockSessions: Array<{ id: string; title: string; provider_id: string; model_id: string | null; created_at: string; updated_at: string }> = []

vi.mock('../db/index', () => {
  const db = {
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes('DELETE FROM messages WHERE session_id')) {
          const sessionId = args[0] as string
          let i = mockMessages.length - 1
          while (i >= 0) {
            if (mockMessages[i].session_id === sessionId) mockMessages.splice(i, 1)
            i--
          }
          return { changes: 1 }
        }
        if (sql.includes('UPDATE sessions SET model_id')) {
          const [modelId, updatedAt, sessionId] = args as [string, string, string]
          const s = mockSessions.find(s => s.id === sessionId)
          if (s) { s.model_id = modelId; s.updated_at = updatedAt; return { changes: 1 } }
          return { changes: 0 }
        }
        return { changes: 0 }
      },
      get: (id: string) => mockSessions.find(s => s.id === id),
      all: () => mockSessions,
    }),
  }
  return { getDb: () => db }
})

import { sessionRepo } from './session-repo'

describe('sessionRepo.updateModel', () => {
  it('updates model_id in sessions table', () => {
    mockSessions.length = 0
    mockSessions.push({ id: 'sess-1', title: 'T', provider_id: 'p1', model_id: 'openai/gpt-3.5', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' })
    const result = sessionRepo.updateModel('sess-1', 'openai/gpt-4o')
    expect(result?.model_id).toBe('openai/gpt-4o')
  })

  it('returns null when session does not exist', () => {
    mockSessions.length = 0
    const result = sessionRepo.updateModel('non-existent', 'openai/gpt-4o')
    expect(result).toBeNull()
  })
})
