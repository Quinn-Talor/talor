import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import log from 'electron-log'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  recreateSessionsIfOutdated,
  cleanupOrphanRunningSubSessions,
  ensureMcpServerColumns,
  LEGACY_TABLES,
  setupSchema,
} from './index'

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
  reasoning TEXT,
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

  it('AC-013 (trigger): drops sessions when its schema is missing parent_message_id/status', () => {
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

    db.exec('DROP TABLE messages')
    recreateSessionsIfOutdated(db)

    expect(tableExists(db, 'sessions')).toBe(false)
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

    recreateSessionsIfOutdated(db)

    expect(tableExists(db, 'sessions')).toBe(false)
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

const NOW = '2026-10-19T00:00:00.000Z'

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
}

describe('setupSchema drops the legacy tables (D2 AC-008)', () => {
  /** 旧库：最新的 sessions + 八张旧表各一行（列只取最小集，DROP 不看结构）。 */
  function legacyDb(): Database.Database {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(CREATE_SESSIONS_FULL)
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, created_at, updated_at) VALUES ('s-1', 't', 'p1', ?, ?)`,
    ).run(NOW, NOW)
    db.exec(CREATE_MESSAGES)
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('m', 's-1', 'user', '"hi"', ?)`,
    ).run(NOW)
    db.exec(`
      CREATE TABLE traces (id TEXT PRIMARY KEY);
      CREATE TABLE observations (id TEXT PRIMARY KEY, trace_id TEXT REFERENCES traces(id) ON DELETE CASCADE);
      CREATE TABLE scores (id TEXT PRIMARY KEY, trace_id TEXT REFERENCES traces(id) ON DELETE CASCADE);
      CREATE TABLE trace_blobs (hash TEXT, trace_id TEXT REFERENCES traces(id) ON DELETE CASCADE);
      CREATE TABLE session_summaries (session_id TEXT PRIMARY KEY);
      CREATE TABLE side_effect_log (id TEXT PRIMARY KEY);
      CREATE TABLE reflection_ledger (id TEXT PRIMARY KEY);
      INSERT INTO traces VALUES ('t');
      INSERT INTO observations VALUES ('o', 't');
      INSERT INTO scores VALUES ('sc', 't');
      INSERT INTO trace_blobs VALUES ('h', 't');
      INSERT INTO session_summaries VALUES ('s-1');
      INSERT INTO side_effect_log VALUES ('e');
      INSERT INTO reflection_ledger VALUES ('r');
    `)
    return db
  }

  it('AC-008 drops the eight legacy tables, keeps sessions rows, and is idempotent', () => {
    const db = legacyDb()
    for (const t of LEGACY_TABLES) expect(tableExists(db, t)).toBe(true)
    vi.mocked(log.info).mockClear()

    setupSchema(db)

    for (const t of LEGACY_TABLES) expect(tableExists(db, t)).toBe(false)
    expect(LEGACY_TABLES).toHaveLength(8)
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 's-1' }])
    for (const t of ['sessions', 'mcp_servers', 'account_keys'])
      expect(tableExists(db, t)).toBe(true)
    expect(vi.mocked(log.info)).toHaveBeenCalledWith('[ChatDB] dropped legacy tables', [
      ...LEGACY_TABLES,
    ])

    vi.mocked(log.info).mockClear()
    expect(() => setupSchema(db)).not.toThrow()
    expect(vi.mocked(log.info)).not.toHaveBeenCalledWith(
      '[ChatDB] dropped legacy tables',
      expect.anything(),
    )
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 's-1' }])
    db.close()
  })

  it('AC-008 creates only the current tables on a fresh database', () => {
    const db = new Database(':memory:')
    setupSchema(db)
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    expect(tables).toEqual(['account_keys', 'mcp_servers', 'sessions'])
    db.close()
  })
})

describe('ensureMcpServerColumns (engine-mcp-credentials TASK-1)', () => {
  const CREATE_MCP_SERVERS_OLD = `
CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('stdio', 'http')),
    command TEXT,
    args TEXT,
    env TEXT,
    url TEXT,
    auth TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`

  it('AC-001 adds env_from_account once and keeps existing rows', () => {
    const db = new Database(':memory:')
    db.exec(CREATE_MCP_SERVERS_OLD)
    db.prepare(
      `INSERT INTO mcp_servers (id, name, type, command, created_at, updated_at)
       VALUES ('m1', 'fs', 'stdio', 'npx', ?, ?)`,
    ).run(NOW, NOW)
    vi.mocked(log.info).mockClear()

    ensureMcpServerColumns(db)
    expect(() => ensureMcpServerColumns(db)).not.toThrow()

    expect(columnNames(db, 'mcp_servers')).toContain('env_from_account')
    expect(vi.mocked(log.info)).toHaveBeenCalledTimes(1)
    expect(db.prepare('SELECT name, env_from_account FROM mcp_servers').all()).toEqual([
      { name: 'fs', env_from_account: null },
    ])
    db.close()
  })
})
