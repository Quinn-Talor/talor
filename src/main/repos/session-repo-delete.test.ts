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

const SCHEMA = `
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

function create(parent?: string) {
  return sessionRepo.create({
    title: 't',
    provider_id: 'p',
    agent_id: 'a',
    ...(parent ? { parent_session_id: parent } : {}),
  })
}

describe('sessionRepo.delete', () => {
  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(SCHEMA)
  })
  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  it('removes delegated descendant sessions together with the parent', () => {
    const root = create()
    const child = create(root.id)
    const grandchild = create(child.id)

    sessionRepo.delete(root.id)

    expect(sessionRepo.getById(root.id)).toBeNull()
    expect(sessionRepo.getById(child.id)).toBeNull()
    expect(sessionRepo.getById(grandchild.id)).toBeNull()
  })

  it('leaves unrelated sessions untouched', () => {
    const root = create()
    const other = create()
    const otherChild = create(other.id)

    sessionRepo.delete(root.id)

    expect(sessionRepo.getById(other.id)).not.toBeNull()
    expect(sessionRepo.getById(otherChild.id)).not.toBeNull()
  })
})
