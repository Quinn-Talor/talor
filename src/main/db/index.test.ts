import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { recreateSessionsIfOutdated, cleanupOrphanRunningSubSessions } from './index'

const CREATE_SESSIONS_OLD = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const CREATE_SESSIONS_FULL = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('running', 'completed', 'aborted')),
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const CREATE_MESSAGES = `
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'blocks',
  agent_id     TEXT NOT NULL DEFAULT '__chat__',
  created_at   TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

function createOldSchemaDb() {
  const db = new Database(':memory:')
  db.exec(CREATE_SESSIONS_OLD)
  db.exec(CREATE_MESSAGES)
  return db
}

function createFullSchemaDb() {
  const db = new Database(':memory:')
  db.exec(CREATE_SESSIONS_FULL)
  db.exec(CREATE_MESSAGES)
  return db
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

describe('recreateSessionsIfOutdated (TASK-1, AC-013)', () => {
  let db: ReturnType<typeof createOldSchemaDb>

  afterEach(() => {
    if (db && db.open) db.close()
  })

  it('AC-013 (trigger): drops sessions+messages when sessions schema is missing parent_message_id/status', () => {
    db = createOldSchemaDb()
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('old-1', 'Old session', 'p1', '2026-04-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z')
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, agent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('m-1', 'old-1', 'user', '"hi"', '__chat__', '2026-04-01T00:00:00.000Z')

    expect(tableExists(db, 'sessions')).toBe(true)
    expect(tableExists(db, 'messages')).toBe(true)

    recreateSessionsIfOutdated(db)

    expect(tableExists(db, 'sessions')).toBe(false)
    expect(tableExists(db, 'messages')).toBe(false)
  })

  it('also drops tables when messages schema is missing agent_id (covers messages-table outdated)', () => {
    db = new Database(':memory:')
    db.exec(CREATE_SESSIONS_FULL)
    // Old messages without agent_id
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'blocks',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `)

    recreateSessionsIfOutdated(db)

    expect(tableExists(db, 'sessions')).toBe(false)
    expect(tableExists(db, 'messages')).toBe(false)
  })

  it('AC-013 (no-trigger): does NOT drop tables when both schemas already match latest', () => {
    db = createFullSchemaDb()
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      's-1',
      'Existing',
      'p1',
      'completed',
      '2026-05-07T00:00:00.000Z',
      '2026-05-07T00:00:00.000Z',
    )

    recreateSessionsIfOutdated(db)

    expect(tableExists(db, 'sessions')).toBe(true)
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s-1') as {
      id: string
      status: string
    }
    expect(row.id).toBe('s-1')
    expect(row.status).toBe('completed')
  })

  it('AC-013: drops when metadata column missing', () => {
    db = new Database(':memory:')
    db.exec(`
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
    `)
    db.exec(CREATE_MESSAGES)

    recreateSessionsIfOutdated(db)

    expect(tableExists(db, 'sessions')).toBe(false)
    expect(tableExists(db, 'messages')).toBe(false)
  })

  it('no-op on fresh database (no sessions table at all)', () => {
    db = new Database(':memory:')
    expect(tableExists(db, 'sessions')).toBe(false)

    expect(() => recreateSessionsIfOutdated(db)).not.toThrow()

    expect(tableExists(db, 'sessions')).toBe(false)
  })
})

describe('cleanupOrphanRunningSubSessions (TASK-1, AC-015)', () => {
  let db: ReturnType<typeof createFullSchemaDb>

  beforeEach(() => {
    db = createFullSchemaDb()
  })

  afterEach(() => {
    db.close()
  })

  it('AC-015 (trigger): converts running sub-sessions to aborted', () => {
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, parent_session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-1',
      'Sub running',
      'p1',
      'main-1',
      'running',
      '2026-05-07T00:00:00.000Z',
      '2026-05-07T00:00:00.000Z',
    )

    cleanupOrphanRunningSubSessions(db)

    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('sub-1') as {
      status: string
    }
    expect(row.status).toBe('aborted')
  })

  it('AC-015 (no-trigger): does not touch top-level running sessions (parent_session_id IS NULL)', () => {
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, parent_session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'top-1',
      'Top running',
      'p1',
      null,
      'running',
      '2026-05-07T00:00:00.000Z',
      '2026-05-07T00:00:00.000Z',
    )

    cleanupOrphanRunningSubSessions(db)

    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('top-1') as {
      status: string
    }
    expect(row.status).toBe('running')
  })

  it('AC-015 (no-trigger): does not touch already-completed sub-sessions', () => {
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, parent_session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-done',
      'Sub done',
      'p1',
      'main-1',
      'completed',
      '2026-05-07T00:00:00.000Z',
      '2026-05-07T00:00:00.000Z',
    )

    cleanupOrphanRunningSubSessions(db)

    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('sub-done') as {
      status: string
    }
    expect(row.status).toBe('completed')
  })
})
