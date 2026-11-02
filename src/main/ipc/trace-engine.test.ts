// trace IPC 合并引擎运行档案（C3 AC-004 / AC-005）：真实 traceRepo + :memory: SQLite，运行档案为 memoryArchive。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockHandle, currentDb, archiveState, getRuntime, runArchive } = vi.hoisted(() => {
  const archiveState = { path: '', archive: null as unknown }
  return {
    mockHandle: vi.fn(),
    currentDb: { instance: null as Database.Database | null },
    archiveState,
    getRuntime: vi.fn(),
    runArchive: vi.fn(() => archiveState.archive),
  }
})

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
vi.mock('../runtime/run-archive', () => ({
  runsDbPath: () => archiveState.path,
  runArchive: () => runArchive(),
}))
vi.mock('../runtime/engine', () => ({ getRuntime }))

import { memoryArchive, type Archive, type RunEvent } from 'agent-engine'
import { ensureMessagesTraceColumn, initTraceTables } from '../db/index'
import { registerTraceHandlers } from './trace'

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`handler not registered for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

const db = () => currentDb.instance!

function insertTrace(id: string, timestamp: string) {
  db()
    .prepare(
      `INSERT INTO traces (id, timestamp, name, session_id, environment, end_time, created_at, updated_at)
       VALUES (?, ?, 'turn', 's1', 'development', ?, ?, ?)`,
    )
    .run(id, timestamp, timestamp, timestamp, timestamp)
}

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }

async function engineRun(archive: Archive, runId: string, at: number, blob: string) {
  const bodies: Array<Record<string, unknown>> = [
    {
      t: 'run_started',
      agent: { id: 'a', fingerprint: 'f' },
      task: { fingerprint: 'f', subject: 's1' },
      environment: { name: 'interactive', fingerprint: 'f', principalReachable: true },
      engine: { fingerprint: 'f' },
      capabilities: [],
      unavailable: [],
      model: 'talor:p1/m1',
      queuedMs: 0,
      rootRunId: runId,
      schemaVersion: 1,
    },
    { t: 'step_started', step: 1 },
    { t: 'context_built', step: 1, messages: [blob], tools: [], estimate: 1 },
    {
      t: 'model_responded',
      step: 1,
      startedAt: at,
      response: {
        text: '',
        toolCalls: [{ id: 'c-new', name: 'read', input: {} }],
        finishReason: 'tool-calls',
        usage,
        warnings: [],
        attempts: [],
      },
    },
    {
      t: 'tool_finished',
      callId: 'c-new',
      capability: 'builtin',
      effect: 'none',
      shown: blob,
      isError: false,
      startedAt: at,
      durationMs: 45,
    },
    {
      t: 'evaluated',
      step: 1,
      observation: {},
      opinions: [],
      verdict: { continue: {}, sources: [] },
    },
    { t: 'step_ended', step: 1 },
    {
      t: 'run_ended',
      result: { runId, status: 'completed', model: 'talor:p1/m1', usage, steps: 1, toolCalls: 1 },
    },
  ]
  await archive.append(
    runId,
    bodies.map((b, i) => ({ seq: i + 1, at: at + i, ...b }) as unknown as RunEvent),
  )
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'talor-trace-engine-'))
  archiveState.path = join(dir, 'runs.db')
  archiveState.archive = memoryArchive()
  runArchive.mockClear()
  getRuntime.mockClear()
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
  d.prepare(`INSERT INTO sessions (id) VALUES ('s1')`).run()
  currentDb.instance = d
  mockHandle.mockClear()
  registerTraceHandlers()
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
  rmSync(dir, { recursive: true, force: true })
})

describe('trace IPC with the engine archive', () => {
  it('AC-004 merges legacy traces and engine runs across the five channels', async () => {
    writeFileSync(archiveState.path, '')
    const archive = archiveState.archive as Archive
    insertTrace('t-old', '2026-10-19T10:00:00.000Z')
    db()
      .prepare(
        `INSERT INTO observations (id, trace_id, type, name, start_time, end_time, metadata, environment)
         VALUES ('o1', 't-old', 'TOOL', 'read', '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.100Z', ?, 'development')`,
      )
      .run(JSON.stringify({ tool_call_id: 'c-old' }))
    const blob = await archive.putBlob(JSON.stringify({ role: 'user', content: 'hi' }))
    await engineRun(archive, 'run-new', Date.parse('2026-10-20T10:00:00.000Z'), blob)

    const list = (await handler('trace:list')({}, { session_id: 's1' })) as {
      status: string
      traces: Array<{ id: string }>
    }
    expect(list.traces.map((t) => t.id)).toEqual(['run-new', 't-old'])

    const got = (await handler('trace:get')({}, { trace_id: 'run-new' })) as {
      status: string
      trace: { metadata: Record<string, unknown> }
    }
    expect(got.status).toBe('success')
    expect(got.trace.metadata.source).toBe('engine')

    const old = (await handler('trace:get')({}, { trace_id: 't-old' })) as {
      status: string
      trace: { id: string; metadata: Record<string, unknown> }
      observations: Array<{ id: string }>
    }
    expect(old.status).toBe('success')
    expect(old.trace.metadata.source).toBeUndefined()
    expect(old.observations.map((o) => o.id)).toEqual(['o1'])

    expect(await handler('trace:blob:get')({}, { trace_id: 'run-new', hash: blob })).toEqual({
      status: 'success',
      content: JSON.stringify({ role: 'user', content: 'hi' }),
    })
    expect(
      await handler('trace:blob:get')(
        {},
        { trace_id: 'run-new', hash: `sha256:${'1'.repeat(64)}` },
      ),
    ).toMatchObject({ status: 'failure', error_code: 'TRACE_NOT_FOUND' })

    expect(
      await handler('trace:score:create')(
        {},
        {
          trace_id: 'run-new',
          name: 'user_feedback',
          data_type: 'BOOLEAN',
          value: 1,
          source: 'ANNOTATION',
        },
      ),
    ).toMatchObject({ status: 'failure', error_code: 'TRACE_NOT_FOUND' })

    expect(await handler('trace:tool-durations')({}, { session_id: 's1' })).toEqual({
      status: 'success',
      durations: { 'c-old': 100, 'c-new': 45 },
    })
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('AC-005 gives only legacy results and creates no runs.db when the archive file is missing', async () => {
    insertTrace('t-old', '2026-10-19T10:00:00.000Z')

    const list = (await handler('trace:list')({}, { session_id: 's1' })) as {
      traces: Array<{ id: string }>
    }
    expect(list.traces.map((t) => t.id)).toEqual(['t-old'])
    expect(await handler('trace:get')({}, { trace_id: 'x' })).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_NOT_FOUND',
    })
    expect(existsSync(archiveState.path)).toBe(false)
    expect(runArchive).not.toHaveBeenCalled()
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('falls back to legacy results when reading the archive throws', async () => {
    writeFileSync(archiveState.path, '')
    insertTrace('t-old', '2026-10-19T10:00:00.000Z')
    const broken = memoryArchive()
    broken.query = async () => {
      throw new Error('locked')
    }
    broken.read = () => {
      throw new Error('locked')
    }
    archiveState.archive = broken
    const list = (await handler('trace:list')({}, { session_id: 's1' })) as {
      traces: Array<{ id: string }>
    }
    expect(list.traces.map((t) => t.id)).toEqual(['t-old'])
    expect(await handler('trace:get')({}, { trace_id: 'x' })).toMatchObject({
      error_code: 'TRACE_READ_FAILED',
    })
  })
})
