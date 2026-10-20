// trace IPC 单测：真实 traceRepo / messageRepo + :memory: SQLite，handler 取法照 providers.test.ts。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockHandle, currentDb } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

vi.mock('../db/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index')>()
  return {
    ...actual,
    getDb: () => {
      if (!currentDb.instance) throw new Error('Test DB not initialized')
      return currentDb.instance
    },
  }
})

import { ensureMessagesTraceColumn, initTraceTables } from '../db/index'
import { traceRepo } from '../repos/trace-repo'
import { registerTraceHandlers } from './trace'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`handler not registered for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function db(): Database.Database {
  return currentDb.instance!
}

function insertTrace(id: string, sessionId: string, timestamp: string): void {
  db()
    .prepare(
      `INSERT INTO traces (id, timestamp, name, session_id, environment, end_time, created_at, updated_at)
       VALUES (?, ?, 'turn', ?, 'development', ?, ?, ?)`,
    )
    .run(id, timestamp, sessionId, timestamp, timestamp, timestamp)
}

function insertObs(
  id: string,
  traceId: string,
  type: string,
  start: string,
  end: string | null,
  metadata: Record<string, unknown> = {},
): void {
  db()
    .prepare(
      `INSERT INTO observations (id, trace_id, type, name, start_time, end_time, metadata, environment)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'development')`,
    )
    .run(id, traceId, type, id, start, end, JSON.stringify(metadata))
}

beforeEach(() => {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  d.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'blocks', agent_id TEXT NOT NULL DEFAULT '__chat__',
      created_at TEXT NOT NULL
    );
  `)
  initTraceTables(d)
  ensureMessagesTraceColumn(d)
  d.prepare(`INSERT INTO sessions (id) VALUES ('s1'), ('s2')`).run()
  currentDb.instance = d
  mockHandle.mockClear()
  registerTraceHandlers()
})

afterEach(() => {
  vi.restoreAllMocks()
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('trace:list / trace:get', () => {
  it('AC-023: list is newest-first and session-scoped; get returns the full trace; errors become structured results', async () => {
    insertTrace('t-a', 's1', '2026-10-19T10:00:00.000Z')
    insertTrace('t-b', 's1', '2026-10-19T11:00:00.000Z')
    insertTrace('t-c', 's1', '2026-10-19T12:00:00.000Z')
    insertTrace('t-x', 's2', '2026-10-19T13:00:00.000Z')
    insertObs('o2', 't-c', 'TOOL', '2026-10-19T12:00:02.000Z', '2026-10-19T12:00:03.000Z')
    insertObs('o1', 't-c', 'GENERATION', '2026-10-19T12:00:01.000Z', '2026-10-19T12:00:02.000Z')
    db()
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at, trace_id)
         VALUES ('m1', 's1', 'assistant', '[]', '2026-10-19T12:00:04.000Z', 't-c')`,
      )
      .run()

    const list = (await getHandler('trace:list')({}, { session_id: 's1', limit: 50 })) as {
      status: string
      traces: Array<{
        id: string
        generation_count: number
        tool_count: number
        error_count: number
        usage: unknown
      }>
    }
    expect(list.status).toBe('success')
    expect(list.traces.map((t) => t.id)).toEqual(['t-c', 't-b', 't-a'])
    expect(list.traces[0]).toMatchObject({ generation_count: 1, tool_count: 1, error_count: 0 })
    expect(list.traces[0].usage).toBeDefined()

    const got = (await getHandler('trace:get')({}, { trace_id: 't-c' })) as {
      status: string
      trace: { id: string }
      observations: Array<{ id: string }>
      scores: unknown[]
      messages: Array<{ id: string; trace_id?: string }>
    }
    expect(got.status).toBe('success')
    expect(got.trace.id).toBe('t-c')
    expect(got.observations.map((o) => o.id)).toEqual(['o1', 'o2'])
    expect(got.scores).toEqual([])
    expect(got.messages).toEqual([expect.objectContaining({ id: 'm1', trace_id: 't-c' })])

    expect(await getHandler('trace:get')({}, { trace_id: 'nope' })).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_NOT_FOUND',
    })

    vi.spyOn(traceRepo, 'list').mockImplementation(() => {
      throw new Error('db locked')
    })
    expect(await getHandler('trace:list')({}, { session_id: 's1' })).toEqual({
      status: 'failure',
      error_code: 'TRACE_READ_FAILED',
      message: 'db locked',
    })
  })

  it('list uses limit 50 by default', async () => {
    const spy = vi.spyOn(traceRepo, 'list')
    await getHandler('trace:list')({}, { session_id: 's1' })
    expect(spy).toHaveBeenCalledWith('s1', 50)
  })

  it('trace:get maps repo errors to TRACE_READ_FAILED', async () => {
    vi.spyOn(traceRepo, 'getById').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await getHandler('trace:get')({}, { trace_id: 't' })).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_READ_FAILED',
    })
  })
})

describe('trace:blob:get', () => {
  it('returns blob content, TRACE_NOT_FOUND when missing, TRACE_READ_FAILED on error', async () => {
    insertTrace('t-a', 's1', '2026-10-19T10:00:00.000Z')
    db()
      .prepare(
        `INSERT INTO trace_blobs (trace_id, hash, bytes, content) VALUES ('t-a', 'h1', 2, '"x"')`,
      )
      .run()
    const handler = getHandler('trace:blob:get')
    expect(await handler({}, { trace_id: 't-a', hash: 'h1' })).toEqual({
      status: 'success',
      content: '"x"',
    })
    expect(await handler({}, { trace_id: 't-a', hash: 'h9' })).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_NOT_FOUND',
    })
    vi.spyOn(traceRepo, 'getBlob').mockImplementation(() => {
      throw new Error('io')
    })
    expect(await handler({}, { trace_id: 't-a', hash: 'h1' })).toMatchObject({
      error_code: 'TRACE_READ_FAILED',
    })
  })
})

describe('trace:score:create', () => {
  it('AC-024: valid BOOLEAN feedback is stored; invalid input is rejected without writing', async () => {
    insertTrace('t1', 's1', '2026-10-19T10:00:00.000Z')
    const handler = getHandler('trace:score:create')
    const ok = (await handler(
      {},
      {
        trace_id: 't1',
        name: 'user_feedback',
        data_type: 'BOOLEAN',
        value: 1,
        source: 'ANNOTATION',
      },
    )) as { status: string; score: { id: string; value: number; environment: string } }
    expect(ok.status).toBe('success')
    expect(ok.score.value).toBe(1)
    expect(ok.score.environment).toBe('development')

    for (const bad of [
      { trace_id: 't1', name: '', data_type: 'BOOLEAN', value: 1, source: 'ANNOTATION' },
      { trace_id: 't1', name: 'x', data_type: 'SCALE', value: 1, source: 'ANNOTATION' },
      { trace_id: 't1', name: 'x', data_type: 'BOOLEAN', value: 2, source: 'ANNOTATION' },
    ]) {
      expect(await handler({}, bad)).toMatchObject({
        status: 'failure',
        error_code: 'TRACE_SCORE_INVALID',
      })
    }
    expect(traceRepo.listScores('t1')).toHaveLength(1)
  })

  it('CATEGORICAL / TEXT need string_value; NUMERIC needs a finite value', async () => {
    insertTrace('t1', 's1', '2026-10-19T10:00:00.000Z')
    const handler = getHandler('trace:score:create')
    expect(
      await handler({}, { trace_id: 't1', name: 'c', data_type: 'CATEGORICAL', source: 'API' }),
    ).toMatchObject({ error_code: 'TRACE_SCORE_INVALID' })
    expect(
      await handler({}, { trace_id: 't1', name: 'n', data_type: 'NUMERIC', source: 'EVAL' }),
    ).toMatchObject({ error_code: 'TRACE_SCORE_INVALID' })
    const text = (await handler(
      {},
      {
        trace_id: 't1',
        name: 'note',
        data_type: 'TEXT',
        string_value: 'good',
        value: 9,
        source: 'API',
      },
    )) as { status: string; score: { value: number; string_value: string } }
    expect(text.status).toBe('success')
    expect(text.score).toMatchObject({ value: 0, string_value: 'good' })
  })

  it('maps a repo write error to TRACE_WRITE_FAILED', async () => {
    vi.spyOn(traceRepo, 'createScore').mockImplementation(() => {
      throw new Error('readonly')
    })
    expect(
      await getHandler('trace:score:create')(
        {},
        { trace_id: 't1', name: 'f', data_type: 'BOOLEAN', value: 0, source: 'ANNOTATION' },
      ),
    ).toMatchObject({ status: 'failure', error_code: 'TRACE_WRITE_FAILED' })
  })
})

describe('trace:tool-durations', () => {
  it('AC-026: returns ended TOOL durations of the session keyed by tool_call_id', async () => {
    insertTrace('t1', 's1', '2026-10-19T10:00:00.000Z')
    insertTrace('t2', 's1', '2026-10-19T11:00:00.000Z')
    insertObs('tool-1', 't1', 'TOOL', '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.412Z', {
      tool_call_id: 'call-1',
    })
    insertObs('tool-2', 't2', 'TOOL', '2026-10-19T11:00:00.000Z', null, { tool_call_id: 'call-2' })
    expect(await getHandler('trace:tool-durations')({}, { session_id: 's1' })).toEqual({
      status: 'success',
      durations: { 'call-1': 412 },
    })
    vi.spyOn(traceRepo, 'listToolDurations').mockImplementation(() => {
      throw new Error('x')
    })
    expect(await getHandler('trace:tool-durations')({}, { session_id: 's1' })).toMatchObject({
      error_code: 'TRACE_READ_FAILED',
    })
  })
})
