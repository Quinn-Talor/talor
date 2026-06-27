import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))

import { sessionRepo } from './session-repo'

const CREATE_SESSIONS = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0
);
`

describe('sessionRepo.addUsage', () => {
  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_SESSIONS)
  })
  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  it('new session starts at zero and rowToSession exposes the columns', () => {
    const s = sessionRepo.create({ title: 't', provider_id: 'p' })
    const got = sessionRepo.getById(s.id)
    expect(got?.input_tokens).toBe(0)
    expect(got?.output_tokens).toBe(0)
    expect(got?.cache_read_tokens).toBe(0)
    expect(got?.cache_write_tokens).toBe(0)
  })

  it('accumulates token usage across calls', () => {
    const s = sessionRepo.create({ title: 't', provider_id: 'p' })
    sessionRepo.addUsage(s.id, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    })
    sessionRepo.addUsage(s.id, {
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    const got = sessionRepo.getById(s.id)
    expect(got?.input_tokens).toBe(120)
    expect(got?.output_tokens).toBe(58)
    expect(got?.cache_read_tokens).toBe(10)
    expect(got?.cache_write_tokens).toBe(5)
  })

  it('addUsage on a missing session is a no-op (no throw)', () => {
    expect(() =>
      sessionRepo.addUsage('nope', {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).not.toThrow()
  })
})
