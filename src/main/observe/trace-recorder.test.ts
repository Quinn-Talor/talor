// trace-recorder 单测：真实 traceRepo + :memory: SQLite，断言落库后的 observation。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import log from 'electron-log'
import { DEFAULT_TRACE_CONFIG, type TraceConfig } from '@shared/types/trace'

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
import { traceRepo } from '../repos/trace-repo'
import { runInScope } from './trace-context'
import { NOOP_OBSERVATION, traceRecorder } from './trace-recorder'

function start(id: string, config: TraceConfig = DEFAULT_TRACE_CONFIG) {
  return traceRecorder.startTrace({
    id,
    sessionId: 's-1',
    name: 'turn',
    input: 'hi',
    rootName: 'agent:test',
    config,
  })
}

function rows(traceId: string) {
  return traceRepo.listObservations(traceId)
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
  db.prepare(
    `INSERT INTO sessions (id, title, provider_id, created_at, updated_at) VALUES ('s-1', 't', 'p', 'x', 'x')`,
  ).run()
  currentDb.instance = db
  traceRecorder.configureEnvironment({ environment: 'development', release: '0.1.0' })
  vi.mocked(log.warn).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('traceRecorder.startTrace / endTrace', () => {
  it('returns null when tracing is disabled', () => {
    expect(start('t-off', { ...DEFAULT_TRACE_CONFIG, enabled: false })).toBeNull()
  })

  it('creates the root AGENT observation and closes it with the trace', () => {
    const scope = start('t1')!
    expect(scope.traceId).toBe('t1')
    traceRecorder.updateRoot('t1', { name: 'agent:__chat__', metadata: { model_id: 'm1' } })
    traceRecorder.endTrace('t1', {
      output: 'done',
      level: 'WARNING',
      metadata: { exit_reason: 'abort' },
    })

    const trace = traceRepo.getById('t1')!
    expect(trace.end_time).not.toBeNull()
    expect(trace.output).toBe('done')
    expect(trace.release).toBe('0.1.0')
    expect(trace.metadata).toMatchObject({ exit_reason: 'abort', model_id: 'm1' })
    const [root] = rows('t1')
    expect(root).toMatchObject({
      id: scope.parent!.observationId,
      type: 'AGENT',
      name: 'agent:__chat__',
      parent_observation_id: null,
      level: 'WARNING',
      input: 'hi',
      output: 'done',
    })
    expect(root.end_time).not.toBeNull()
    expect(root.metadata).toMatchObject({ model_id: 'm1' })
  })

  it('drops observations that arrive after the trace ended and warns once', () => {
    const scope = start('t-late')!
    traceRecorder.endTrace('t-late', {})
    const h1 = traceRecorder.startObservation({ type: 'SPAN', name: 'late', parent: scope.parent! })
    const h2 = traceRecorder.startObservation({
      type: 'SPAN',
      name: 'late2',
      parent: scope.parent!,
    })
    expect(h1).toBe(NOOP_OBSERVATION)
    expect(h2).toBe(NOOP_OBSERVATION)
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
  })
})

describe('traceRecorder observations', () => {
  it('AC-005: nested withObservation links parent; an error marks ERROR and propagates the same instance', async () => {
    const scope = start('t-nest')!
    const boom = new Error('boom')
    let aId = ''
    let caught: unknown
    await runInScope(scope, async () => {
      try {
        await traceRecorder.withObservation({ type: 'CHAIN', name: 'A' }, async (a) => {
          aId = a.ref!.observationId
          await traceRecorder.withObservation({ type: 'SPAN', name: 'B' }, async () => {
            throw boom
          })
        })
      } catch (e) {
        caught = e
      }
    })
    traceRecorder.flush('t-nest')

    const all = rows('t-nest')
    const a = all.find((r) => r.name === 'A')!
    const b = all.find((r) => r.name === 'B')!
    expect(b.parent_observation_id).toBe(aId)
    expect(b.level).toBe('ERROR')
    expect(b.status_message).toBe('boom')
    expect(a.parent_observation_id).toBe(scope.parent!.observationId)
    expect(caught).toBe(boom)
  })

  it('AC-006: without a scope every call is a no-op and nothing is written', async () => {
    const spy = vi.spyOn(traceRepo, 'upsertBatch')
    const h = traceRecorder.startObservation({ type: 'SPAN', name: 'x' })
    expect(h.ref).toBeNull()
    h.update({ name: 'y' })
    h.end()
    await expect(
      traceRecorder.withObservation({ type: 'SPAN', name: 'x' }, async () => 42),
    ).resolves.toBe(42)
    traceRecorder.event({ name: 'e' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('end is idempotent (BR-101) and update merges name/metadata before end', async () => {
    const scope = start('t-idem')!
    await runInScope(scope, async () => {
      const h = traceRecorder.startObservation({ type: 'SPAN', name: 'x', metadata: { a: 1 } })
      h.update({ name: 'renamed', metadata: { b: 2 } })
      h.end({ level: 'WARNING', statusMessage: 'first' })
      h.end({ level: 'ERROR', statusMessage: 'second' })
      h.update({ name: 'ignored' })
    })
    traceRecorder.flush('t-idem')
    const o = rows('t-idem').find((r) => r.type === 'SPAN')!
    expect(o).toMatchObject({ name: 'renamed', level: 'WARNING', status_message: 'first' })
    expect(o.metadata).toEqual({ a: 1, b: 2 })
  })

  it('event creates an ended EVENT under the current parent', async () => {
    const scope = start('t-evt')!
    await runInScope(scope, async () => {
      traceRecorder.event({
        name: 'hint.injected',
        input: 'H1',
        level: 'DEBUG',
        metadata: { source: 's' },
      })
    })
    traceRecorder.flush('t-evt')
    const e = rows('t-evt').find((r) => r.type === 'EVENT')!
    expect(e).toMatchObject({
      name: 'hint.injected',
      input: 'H1',
      level: 'DEBUG',
      parent_observation_id: scope.parent!.observationId,
    })
    expect(e.end_time).toBe(e.start_time)
    expect(e.metadata).toEqual({ source: 's' })
  })

  it('stores prompt messages as hashes with per-trace blob dedupe', async () => {
    const scope = start('t-blob')!
    const prompt = [
      { role: 'system', content: 'You are Talor' },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]
    await runInScope(scope, async () => {
      traceRecorder
        .startObservation({ type: 'GENERATION', name: 'g1', promptMessages: prompt })
        .end()
      traceRecorder
        .startObservation({ type: 'GENERATION', name: 'g2', promptMessages: prompt })
        .end()
    })
    traceRecorder.flush('t-blob')
    const g1 = rows('t-blob').find((r) => r.name === 'g1')!
    const parsed = JSON.parse(g1.input!) as {
      messages: Array<{ role: string; hash: string; bytes: number }>
    }
    expect(parsed.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(parsed.messages[0].hash).toMatch(/^[0-9a-f]{16}$/)
    expect(traceRepo.getBlob('t-blob', parsed.messages[0].hash)).toBe(
      JSON.stringify('You are Talor'),
    )
    const blobCount = (
      currentDb.instance!.prepare('SELECT COUNT(*) AS n FROM trace_blobs').get() as { n: number }
    ).n
    expect(blobCount).toBe(2)
  })

  it('records environment from configureEnvironment', async () => {
    traceRecorder.configureEnvironment({ environment: 'production', release: '9.9.9' })
    expect(traceRecorder.getEnvironment()).toBe('production')
    const scope = start('t-env')!
    await runInScope(scope, async () => {
      traceRecorder.startObservation({ type: 'SPAN', name: 'x' }).end()
    })
    traceRecorder.endTrace('t-env', {})
    expect(traceRepo.getById('t-env')!.environment).toBe('production')
    expect(rows('t-env').every((r) => r.environment === 'production')).toBe(true)
  })
})

describe('traceRecorder payload hygiene', () => {
  it('AC-008: redacts secrets and sk- keys; truncates oversize payloads with metadata', async () => {
    const scope = start('t-red')!
    traceRecorder.addSecret('t-red', 'sk-test-abcdefghijklmnopqrstuv')
    await runInScope(scope, async () => {
      traceRecorder
        .startObservation({
          type: 'SPAN',
          name: 'leak',
          input: {
            key: 'sk-test-abcdefghijklmnopqrstuv',
            auth: 'Bearer abcdefghijklmnopqrstuvwxyz0123',
          },
        })
        .end()
      traceRecorder
        .startObservation({ type: 'SPAN', name: 'big' })
        .end({ output: 'a'.repeat(1_200_000) })
    })
    traceRecorder.flush('t-red')

    const leak = rows('t-red').find((r) => r.name === 'leak')!
    expect(leak.input).not.toContain('sk-test-abcdefghijklmnopqrstuv')
    expect(leak.input).not.toContain('abcdefghijklmnopqrstuvwxyz0123')
    expect(leak.input).toContain('[REDACTED]')
    const big = rows('t-red').find((r) => r.name === 'big')!
    expect(Buffer.byteLength(big.output!, 'utf8')).toBeLessThanOrEqual(1048576)
    expect(big.metadata.truncated_fields).toEqual(['output'])
    expect(big.metadata.original_bytes).toEqual({ output: 1200000 })
  })

  it('AC-008 (no-trigger): short sk- strings and payloads under the limit are kept verbatim', async () => {
    const scope = start('t-keep')!
    await runInScope(scope, async () => {
      traceRecorder.startObservation({ type: 'SPAN', name: 'k', input: 'use sk-short here' }).end({
        output: 'b'.repeat(1000),
      })
    })
    traceRecorder.flush('t-keep')
    const k = rows('t-keep')[1]
    expect(k.input).toBe('use sk-short here')
    expect(k.output).toBe('b'.repeat(1000))
    expect(k.metadata.truncated_fields).toBeUndefined()
  })

  it('truncation keeps UTF-8 characters whole', async () => {
    const scope = start('t-utf8', { ...DEFAULT_TRACE_CONFIG, maxPayloadBytes: 1024 })!
    await runInScope(scope, async () => {
      traceRecorder.startObservation({ type: 'SPAN', name: 'u' }).end({ output: '你'.repeat(400) })
    })
    traceRecorder.flush('t-utf8')
    const u = rows('t-utf8').find((r) => r.name === 'u')!
    expect(u.output).toBe('你'.repeat(341))
    expect(u.metadata.original_bytes).toEqual({ output: 1200 })
  })

  it('serializes non-JSON values without throwing', async () => {
    const scope = start('t-circ')!
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await runInScope(scope, async () => {
      traceRecorder.startObservation({ type: 'SPAN', name: 'c', input: circular }).end()
    })
    traceRecorder.flush('t-circ')
    expect(rows('t-circ').find((r) => r.name === 'c')!.input).toBe('[object Object]')
  })
})

describe('traceRecorder flush', () => {
  it('AC-007: flush failures never throw and warn once', () => {
    start('t-fail')
    vi.spyOn(traceRepo, 'upsertBatch').mockImplementation(() => {
      throw new Error('disk')
    })
    expect(() => {
      traceRecorder.flush('t-fail')
      traceRecorder.flush('t-fail')
      traceRecorder.flush('t-fail')
    }).not.toThrow()
    const warns = vi.mocked(log.warn).mock.calls
    expect(warns).toHaveLength(1)
    expect(String(warns[0][0])).toMatch(/^\[TraceRecorder\]/)
  })

  it('reports the total failure count at endTrace when more than one flush failed', () => {
    start('t-fail2')
    vi.spyOn(traceRepo, 'upsertBatch').mockImplementation(() => {
      throw new Error('disk')
    })
    traceRecorder.flush('t-fail2')
    traceRecorder.flush('t-fail2')
    traceRecorder.endTrace('t-fail2', {})
    const msgs = vi.mocked(log.warn).mock.calls.map((c) => String(c[0]))
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toBe('[TraceRecorder] trace t-fail2: 3 flush failures')
  })

  it('a single failure followed by a successful write keeps dirty rows and logs no summary', () => {
    start('t-retry')
    const real = traceRepo.upsertBatch.bind(traceRepo)
    vi.spyOn(traceRepo, 'upsertBatch')
      .mockImplementationOnce(() => {
        throw new Error('busy')
      })
      .mockImplementation(real)
    traceRecorder.flush('t-retry')
    traceRecorder.endTrace('t-retry', {})
    expect(rows('t-retry')).toHaveLength(1)
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
  })

  it('flush writes only dirty observations; flushAll writes every open trace', async () => {
    const scope = start('t-dirty')!
    const spy = vi.spyOn(traceRepo, 'upsertBatch')
    await runInScope(scope, async () => {
      traceRecorder.startObservation({ type: 'SPAN', name: 'x' }).end()
    })
    traceRecorder.flush('t-dirty')
    traceRecorder.flush('t-dirty')
    expect(spy.mock.calls[0][1]).toHaveLength(2)
    expect(spy.mock.calls[1][1]).toHaveLength(0)
    start('t-other')
    traceRecorder.flushAll()
    const flushed = spy.mock.calls.slice(2).map((c) => c[0].id)
    expect(flushed).toEqual(expect.arrayContaining(['t-dirty', 't-other']))
    traceRecorder.endTrace('t-dirty', {})
    traceRecorder.endTrace('t-other', {})
  })
})

describe('traceRecorder.endTrace unfinished children', () => {
  it('closes observations still open at endTrace as WARNING UNFINISHED_AT_TRACE_END', () => {
    const scope = start('t-open')!
    const tool = runInScope(scope, () =>
      traceRecorder.startObservation({ type: 'TOOL', name: 'bash' }),
    )
    traceRecorder.endTrace('t-open', { level: 'WARNING' })
    // trace 结束后才返回的工具:end 写的是已脱离的缓冲,不再改写已落库的结果
    tool.end({ output: 'late' })

    const row = rows('t-open').find((o) => o.name === 'bash')!
    expect(row.end_time).not.toBeNull()
    expect(row).toMatchObject({
      level: 'WARNING',
      status_message: 'UNFINISHED_AT_TRACE_END',
      output: null,
    })
  })

  it('(no-trigger) observations ended before endTrace keep their own level and status', () => {
    const scope = start('t-closed')!
    runInScope(scope, () =>
      traceRecorder.startObservation({ type: 'TOOL', name: 'read' }).end({ output: 'ok' }),
    )
    traceRecorder.endTrace('t-closed', {})

    const row = rows('t-closed').find((o) => o.name === 'read')!
    expect(row).toMatchObject({ level: 'DEFAULT', status_message: null, output: 'ok' })
  })
})
