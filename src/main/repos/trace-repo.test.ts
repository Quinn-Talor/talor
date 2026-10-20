// trace-repo 单测：真实 SQLite(:memory:) + 真实 DDL(initTraceTables)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import log from 'electron-log'
import type { ObservationRecord, TraceBlobRecord, TraceRecord } from '@shared/types/trace'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
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

import { initTraceTables } from '../db/index'
import { traceRepo } from './trace-repo'

const T0 = '2026-10-19T10:00:00.000Z'

function makeTrace(id: string, overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    id,
    timestamp: T0,
    name: 'turn',
    session_id: 's-1',
    user_id: null,
    release: '0.1.0',
    version: null,
    tags: [],
    metadata: {},
    input: 'hello',
    output: null,
    environment: 'development',
    end_time: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  }
}

function makeObs(
  id: string,
  traceId: string,
  overrides: Partial<ObservationRecord> = {},
): ObservationRecord {
  return {
    id,
    trace_id: traceId,
    parent_observation_id: null,
    type: 'SPAN',
    name: id,
    start_time: T0,
    end_time: null,
    completion_start_time: null,
    level: 'DEFAULT',
    status_message: null,
    provided_model_name: null,
    model_parameters: null,
    input: null,
    output: null,
    metadata: {},
    usage_details: null,
    cost_details: null,
    prompt_name: null,
    prompt_version: null,
    version: null,
    environment: 'development',
    ...overrides,
  }
}

function blob(traceId: string, hash: string): TraceBlobRecord {
  return { trace_id: traceId, hash, bytes: 2, content: '{}' }
}

function count(table: string): number {
  return (currentDb.instance!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number })
    .n
}

beforeEach(() => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  initTraceTables(db)
  for (const sid of ['s-1', 's-2']) {
    db.prepare(
      `INSERT INTO sessions (id, title, provider_id, created_at, updated_at) VALUES (?, 't', 'p', ?, ?)`,
    ).run(sid, T0, T0)
  }
  currentDb.instance = db
  vi.mocked(log.info).mockClear()
  vi.mocked(log.warn).mockClear()
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('traceRepo.upsertBatch', () => {
  it('AC-009: writes 10000 observations of one trace in under 2000 ms', () => {
    const obs = Array.from({ length: 10_000 }, (_, i) =>
      makeObs(`o-${i}`, 't-big', {
        type: i % 3 === 0 ? 'GENERATION' : 'SPAN',
        metadata: { step_index: i },
        usage_details: i % 3 === 0 ? { input: 1, output: 1, total: 2 } : null,
      }),
    )
    const started = performance.now()
    traceRepo.upsertBatch(makeTrace('t-big'), obs, [])
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(2000)
    expect(count('observations')).toBe(10_000)
  })

  it('AC-002: upserts trace/observations/blobs; a failing batch rolls back entirely', () => {
    const obs = [makeObs('o1', 't1'), makeObs('o2', 't1'), makeObs('o3', 't1')]
    traceRepo.upsertBatch(makeTrace('t1'), obs, [blob('t1', 'h1'), blob('t1', 'h2')])
    traceRepo.upsertBatch(
      makeTrace('t1', { end_time: '2026-10-19T10:00:09.000Z' }),
      [makeObs('o1', 't1', { end_time: '2026-10-19T10:00:05.000Z', level: 'ERROR' })],
      [blob('t1', 'h1')],
    )

    expect(count('traces')).toBe(1)
    expect(count('observations')).toBe(3)
    expect(count('trace_blobs')).toBe(2)
    const o1 = traceRepo.listObservations('t1').find((o) => o.id === 'o1')!
    expect(o1.end_time).toBe('2026-10-19T10:00:05.000Z')
    expect(o1.level).toBe('ERROR')
    expect(traceRepo.getById('t1')!.end_time).toBe('2026-10-19T10:00:09.000Z')

    expect(() =>
      traceRepo.upsertBatch(
        makeTrace('t1'),
        [makeObs('o4', 't1'), makeObs('o5', 'tx')],
        [blob('t1', 'h3')],
      ),
    ).toThrow()
    expect(count('traces')).toBe(1)
    expect(count('observations')).toBe(3)
    expect(count('trace_blobs')).toBe(2)
  })

  it('logs one info line per committed batch', () => {
    traceRepo.upsertBatch(makeTrace('t1'), [makeObs('o1', 't1')], [])
    const lines = vi
      .mocked(log.info)
      .mock.calls.filter((c) => String(c[0]).startsWith('[TraceRepo] Upserted trace: t1'))
    expect(lines).toHaveLength(1)
  })

  it('round-trips JSON columns', () => {
    traceRepo.upsertBatch(
      makeTrace('t1', { tags: ['a'], metadata: { exit_reason: 'no_tool_calls' } }),
      [
        makeObs('g1', 't1', {
          type: 'GENERATION',
          model_parameters: { temperature: 0.2 },
          usage_details: { input: 7, output: 5, total: 12 },
          metadata: { finish_reason: 'stop' },
        }),
      ],
      [],
    )
    const t = traceRepo.getById('t1')!
    expect(t.tags).toEqual(['a'])
    expect(t.metadata).toEqual({ exit_reason: 'no_tool_calls' })
    const g = traceRepo.listObservations('t1')[0]
    expect(g.model_parameters).toEqual({ temperature: 0.2 })
    expect(g.usage_details).toEqual({ input: 7, output: 5, total: 12 })
    expect(g.metadata).toEqual({ finish_reason: 'stop' })
  })
})

describe('traceRepo reads', () => {
  it('getById returns null for unknown id', () => {
    expect(traceRepo.getById('nope')).toBeNull()
  })

  it('listObservations orders by start_time then insertion order', () => {
    traceRepo.upsertBatch(
      makeTrace('t1'),
      [
        makeObs('late', 't1', { start_time: '2026-10-19T10:00:02.000Z' }),
        makeObs('early', 't1', { start_time: '2026-10-19T10:00:01.000Z' }),
        makeObs('early-2', 't1', { start_time: '2026-10-19T10:00:01.000Z' }),
      ],
      [],
    )
    expect(traceRepo.listObservations('t1').map((o) => o.id)).toEqual(['early', 'early-2', 'late'])
  })

  it('list aggregates per trace, newest first, scoped to the session, limit clamped to >= 1', () => {
    traceRepo.upsertBatch(
      makeTrace('t-old', { timestamp: '2026-10-19T09:00:00.000Z', input: 'x'.repeat(300) }),
      [
        makeObs('g1', 't-old', {
          type: 'GENERATION',
          usage_details: {
            input: 7,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 0,
            output: 5,
            output_reasoning_tokens: 2,
            total: 17,
          },
        }),
        makeObs('g2', 't-old', { type: 'GENERATION', level: 'ERROR' }),
        makeObs('tool1', 't-old', { type: 'TOOL' }),
      ],
      [],
    )
    traceRepo.upsertBatch(
      makeTrace('t-new', {
        timestamp: '2026-10-19T11:00:00.000Z',
        metadata: { exit_reason: 'abort' },
      }),
      [],
      [],
    )
    traceRepo.upsertBatch(makeTrace('t-other', { session_id: 's-2' }), [], [])

    const rows = traceRepo.list('s-1', 50)
    expect(rows.map((r) => r.id)).toEqual(['t-new', 't-old'])
    const old = rows[1]
    expect(old.observation_count).toBe(3)
    expect(old.generation_count).toBe(2)
    expect(old.tool_count).toBe(1)
    expect(old.error_count).toBe(1)
    expect(old.usage).toEqual({
      input: 7,
      output: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 0,
      output_reasoning_tokens: 2,
    })
    expect(old.input_preview).toHaveLength(200)
    expect(rows[0].exit_reason).toBe('abort')
    expect(traceRepo.list('s-1', 0)).toHaveLength(1)
  })

  it('getBlob returns content or null', () => {
    traceRepo.upsertBatch(makeTrace('t1'), [], [blob('t1', 'h1')])
    expect(traceRepo.getBlob('t1', 'h1')).toBe('{}')
    expect(traceRepo.getBlob('t1', 'missing')).toBeNull()
  })

  it('listToolDurations returns ended TOOL observations of the session only', () => {
    traceRepo.upsertBatch(
      makeTrace('t1'),
      [
        makeObs('tool-done', 't1', {
          type: 'TOOL',
          start_time: '2026-10-19T10:00:00.000Z',
          end_time: '2026-10-19T10:00:00.412Z',
          metadata: { tool_call_id: 'call-1' },
        }),
        makeObs('tool-open', 't1', { type: 'TOOL', metadata: { tool_call_id: 'call-2' } }),
        makeObs('span', 't1', { end_time: '2026-10-19T10:00:01.000Z' }),
      ],
      [],
    )
    expect(traceRepo.listToolDurations('s-1')).toEqual([
      { tool_call_id: 'call-1', duration_ms: 412 },
    ])
    expect(traceRepo.listToolDurations('s-2')).toEqual([])
  })
})

describe('traceRepo.createScore / listScores', () => {
  it('generates id and timestamp, persists and lists the score', () => {
    traceRepo.upsertBatch(makeTrace('t1'), [], [])
    const score = traceRepo.createScore({
      trace_id: 't1',
      observation_id: null,
      name: 'user_feedback',
      value: 1,
      string_value: null,
      data_type: 'BOOLEAN',
      source: 'ANNOTATION',
      comment: null,
      environment: 'development',
    })
    expect(score.id).toMatch(/[0-9a-f-]{36}/)
    expect(Number.isNaN(Date.parse(score.timestamp))).toBe(false)
    expect(score.session_id).toBeNull()
    expect(traceRepo.listScores('t1')).toEqual([score])
    const created = vi
      .mocked(log.info)
      .mock.calls.filter((c) => String(c[0]).startsWith('[TraceRepo] Created score:'))
    expect(created).toHaveLength(1)
  })
})
