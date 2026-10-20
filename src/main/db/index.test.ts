import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import log from 'electron-log'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  recreateSessionsIfOutdated,
  cleanupOrphanRunningSubSessions,
  initTraceTables,
  ensureMessagesTraceColumn,
  sweepOpenTraces,
  pruneTraces,
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

// ─── Turn trace 表（turn-trace TASK-1）────────────────────────────────

const NOW = '2026-10-19T00:00:00.000Z'
const DAY_MS = 86_400_000

function indexExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name)
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
}

function countRows(db: Database.Database, table: string, where = '1=1'): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n
}

function createTraceDb(): Database.Database {
  const db = createFullSchemaDb()
  db.pragma('foreign_keys = ON')
  initTraceTables(db)
  db.prepare(
    `INSERT INTO sessions (id, title, provider_id, created_at, updated_at) VALUES ('s-1', 't', 'p1', ?, ?)`,
  ).run(NOW, NOW)
  return db
}

function insertTrace(
  db: Database.Database,
  id: string,
  timestamp: string,
  endTime: string | null,
): void {
  db.prepare(
    `INSERT INTO traces (id, timestamp, name, session_id, environment, end_time, created_at, updated_at)
     VALUES (?, ?, 'turn', 's-1', 'development', ?, ?, ?)`,
  ).run(id, timestamp, endTime, timestamp, timestamp)
}

function insertObservation(
  db: Database.Database,
  id: string,
  traceId: string,
  endTime: string | null,
  level = 'DEFAULT',
): void {
  db.prepare(
    `INSERT INTO observations (id, trace_id, type, name, start_time, end_time, level, environment)
     VALUES (?, ?, 'SPAN', 'x', '2026-10-18T10:00:00.000Z', ?, ?, 'development')`,
  ).run(id, traceId, endTime, level)
}

describe('initTraceTables / ensureMessagesTraceColumn (turn-trace TASK-1)', () => {
  it('AC-001: initTraceTables creates the four trace tables and indexes, idempotent, without touching messages', () => {
    const db = createFullSchemaDb()

    initTraceTables(db)
    expect(() => initTraceTables(db)).not.toThrow()

    for (const t of ['traces', 'observations', 'scores', 'trace_blobs']) {
      expect(tableExists(db, t)).toBe(true)
    }
    for (const i of [
      'idx_traces_session',
      'idx_observations_trace',
      'idx_observations_type',
      'idx_scores_trace',
    ]) {
      expect(indexExists(db, i)).toBe(true)
    }
    // messages.trace_id 是必需迁移,由 ensureMessagesTraceColumn 单独负责(不随 trace 表 fail-open)
    expect(columnNames(db, 'messages')).not.toContain('trace_id')
    expect(indexExists(db, 'idx_messages_trace')).toBe(false)
    db.close()
  })

  it('AC-001: ensureMessagesTraceColumn adds messages.trace_id and its index once, keeping rows', () => {
    const db = createFullSchemaDb()
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, created_at, updated_at) VALUES ('s-1', 't', 'p1', ?, ?)`,
    ).run(NOW, NOW)
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, agent_id, created_at)
       VALUES ('m-1', 's-1', 'user', '"hi"', '__chat__', ?)`,
    ).run(NOW)
    vi.mocked(log.info).mockClear()

    ensureMessagesTraceColumn(db)
    // 第二次:列已存在 → 不再 ALTER
    expect(() => ensureMessagesTraceColumn(db)).not.toThrow()

    expect(columnNames(db, 'messages')).toContain('trace_id')
    expect(indexExists(db, 'idx_messages_trace')).toBe(true)
    expect(countRows(db, 'messages')).toBe(1)
    const alters = vi
      .mocked(log.info)
      .mock.calls.filter((c) => String(c[0]).includes('added messages.trace_id'))
    expect(alters).toHaveLength(1)
    db.close()
  })
})

describe('sweepOpenTraces (turn-trace TASK-1)', () => {
  it('AC-003: closes open traces and observations at the given time, leaves ended rows untouched', () => {
    const db = createTraceDb()
    insertTrace(db, 't1', '2026-10-18T10:00:00.000Z', null)
    insertObservation(db, 'o1', 't1', null)
    insertObservation(db, 'o2', 't1', '2026-10-18T10:00:05.000Z', 'WARNING')
    vi.mocked(log.info).mockClear()

    sweepOpenTraces(db, NOW)

    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      '[ChatDB] Swept 1 open traces, 1 open observations',
    )
    const t1 = db.prepare('SELECT end_time, metadata FROM traces WHERE id = ?').get('t1') as {
      end_time: string
      metadata: string
    }
    expect(t1.end_time).toBe(NOW)
    expect(JSON.parse(t1.metadata).exit_reason).toBe('aborted_by_restart')
    expect(
      db.prepare('SELECT end_time, level, status_message FROM observations WHERE id = ?').get('o1'),
    ).toEqual({ end_time: NOW, level: 'ERROR', status_message: 'ABORTED_BY_RESTART' })
    expect(
      db.prepare('SELECT end_time, level, status_message FROM observations WHERE id = ?').get('o2'),
    ).toEqual({ end_time: '2026-10-18T10:00:05.000Z', level: 'WARNING', status_message: null })
    db.close()
  })

  it('AC-003 (no-trigger): no open rows → nothing logged', () => {
    const db = createTraceDb()
    insertTrace(db, 't1', '2026-10-18T10:00:00.000Z', '2026-10-18T10:00:09.000Z')
    vi.mocked(log.info).mockClear()
    sweepOpenTraces(db, NOW)
    const swept = vi.mocked(log.info).mock.calls.filter((c) => String(c[0]).includes('Swept'))
    expect(swept).toHaveLength(0)
    db.close()
  })
})

describe('pruneTraces (turn-trace TASK-1)', () => {
  it('AC-004: deletes traces older than retentionDays with cascade; retentionDays=0 deletes nothing', () => {
    const db = createTraceDb()
    const now = Date.parse(NOW)
    const oldTs = new Date(now - 31 * DAY_MS).toISOString()
    const newTs = new Date(now - 1 * DAY_MS).toISOString()
    insertTrace(db, 'old', oldTs, oldTs)
    insertObservation(db, 'old-o1', 'old', oldTs)
    insertObservation(db, 'old-o2', 'old', oldTs)
    db.prepare(
      `INSERT INTO scores (id, trace_id, name, value, data_type, source, timestamp, environment)
       VALUES ('sc-1', 'old', 'user_feedback', 1, 'BOOLEAN', 'ANNOTATION', ?, 'development')`,
    ).run(oldTs)
    db.prepare(
      `INSERT INTO trace_blobs (trace_id, hash, bytes, content) VALUES ('old', 'h1', 2, '{}')`,
    ).run()
    insertTrace(db, 'new', newTs, newTs)
    insertObservation(db, 'new-o1', 'new', newTs)

    expect(pruneTraces(db, 30, NOW)).toBe(1)
    expect(countRows(db, 'traces', "id = 'old'")).toBe(0)
    expect(countRows(db, 'observations', "trace_id = 'old'")).toBe(0)
    expect(countRows(db, 'scores', "trace_id = 'old'")).toBe(0)
    expect(countRows(db, 'trace_blobs', "trace_id = 'old'")).toBe(0)
    expect(countRows(db, 'traces', "id = 'new'")).toBe(1)
    expect(countRows(db, 'observations', "trace_id = 'new'")).toBe(1)

    expect(pruneTraces(db, 0, NOW)).toBe(0)
    expect(countRows(db, 'traces')).toBe(1)
    db.close()
  })
})
