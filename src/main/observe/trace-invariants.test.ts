// verifyTraceInvariants 单测：每类违例各造一份数据（触发），干净数据返回空（不触发）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

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
import { verifyTraceInvariants } from './trace-invariants'

const T0 = '2026-10-19T10:00:00.000Z'
const T1 = '2026-10-19T10:00:01.000Z'
const T2 = '2026-10-19T10:00:02.000Z'
const T3 = '2026-10-19T10:00:03.000Z'

function db(): Database.Database {
  return currentDb.instance!
}

function insertObs(
  id: string,
  opts: {
    parent?: string | null
    type?: string
    start?: string
    end?: string | null
    toolCallId?: string
  } = {},
): void {
  db()
    .prepare(
      `INSERT INTO observations (id, trace_id, parent_observation_id, type, name, start_time, end_time, metadata, environment)
       VALUES (?, 't1', ?, ?, ?, ?, ?, ?, 'development')`,
    )
    .run(
      id,
      opts.parent ?? null,
      opts.type ?? 'SPAN',
      id,
      opts.start ?? T1,
      opts.end === undefined ? T2 : opts.end,
      JSON.stringify(opts.toolCallId ? { tool_call_id: opts.toolCallId } : {}),
    )
}

function insertMessage(id: string, role: string, content: unknown, traceId: string | null): void {
  db()
    .prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at, trace_id) VALUES (?, 's1', ?, ?, ?, ?)`,
    )
    .run(id, role, JSON.stringify(content), T1, traceId)
}

/** 一条干净的 trace：root(T0-T3) → step(T1-T2)，含一次配对完整的工具调用。 */
function seedCleanTrace(): void {
  insertObs('root', { type: 'AGENT', start: T0, end: T3 })
  insertObs('step', { parent: 'root', type: 'CHAIN' })
  insertObs('tool', { parent: 'step', type: 'TOOL', toolCallId: 'call-1' })
  insertMessage(
    'm-a',
    'assistant',
    [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'echo', input: {} }],
    't1',
  )
  insertMessage(
    'm-t',
    'tool',
    [
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'echo',
        output: { type: 'text', value: 'ok' },
      },
    ],
    't1',
  )
}

beforeEach(() => {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'blocks', agent_id TEXT NOT NULL DEFAULT '__chat__',
      created_at TEXT NOT NULL, trace_id TEXT
    );
  `)
  initTraceTables(d)
  d.prepare(`INSERT INTO sessions (id) VALUES ('s1')`).run()
  d.prepare(
    `INSERT INTO traces (id, timestamp, name, session_id, environment, created_at, updated_at)
     VALUES ('t1', ?, 'turn', 's1', 'development', ?, ?)`,
  ).run(T0, T0, T0)
  currentDb.instance = d
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('verifyTraceInvariants', () => {
  it('returns no violations for a consistent trace', () => {
    seedCleanTrace()
    expect(verifyTraceInvariants('t1', ['s1'])).toEqual([])
  })

  it('I1: tool calls without a TOOL observation (and vice versa) are reported', () => {
    seedCleanTrace()
    insertMessage(
      'm-a2',
      'assistant',
      [{ type: 'tool-call', toolCallId: 'call-2', toolName: 'echo', input: {} }],
      't1',
    )
    insertObs('tool-orphan', { parent: 'step', type: 'TOOL', toolCallId: 'call-9' })
    expect(verifyTraceInvariants('t1', ['s1'])).toEqual(
      expect.arrayContaining([
        { code: 'I1_TOOL_CALL_UNMATCHED', detail: 'call-2' },
        { code: 'I1_TOOL_CALL_UNMATCHED', detail: 'call-9' },
      ]),
    )
  })

  it('I1 (no-trigger): SDK_TOOL_MISSING_RESULT placeholders are excused', () => {
    seedCleanTrace()
    insertMessage(
      'm-a3',
      'assistant',
      [{ type: 'tool-call', toolCallId: 'call-x', toolName: 'mcp_x', input: {} }],
      't1',
    )
    insertMessage(
      'm-t3',
      'tool',
      [
        {
          type: 'tool-result',
          toolCallId: 'call-x',
          toolName: 'mcp_x',
          output: { type: 'text', value: '{"code":"SDK_TOOL_MISSING_RESULT"}' },
        },
      ],
      't1',
    )
    expect(verifyTraceInvariants('t1', ['s1'])).toEqual([])
  })

  it('I3: messages of the session written during the trace without trace_id', () => {
    seedCleanTrace()
    insertMessage('m-loose', 'assistant', [{ type: 'text', text: 'x' }], null)
    expect(verifyTraceInvariants('t1', ['s1'])).toEqual([
      { code: 'I3_MESSAGE_WITHOUT_TRACE', detail: 'm-loose' },
    ])
  })

  it('I4: open observations, missing parents and children outside their parent window', () => {
    seedCleanTrace()
    insertObs('open', { parent: 'step', end: null })
    insertObs('orphan', { parent: 'ghost' })
    insertObs('late', { parent: 'step', start: T1, end: T3 })
    insertObs('evt', { parent: 'step', type: 'EVENT', start: T3, end: T3 })
    const codes = verifyTraceInvariants('t1', ['s1'])
    expect(codes).toEqual(
      expect.arrayContaining([
        { code: 'I4_OPEN_OBSERVATION', detail: 'open' },
        { code: 'I4_PARENT_MISSING', detail: 'orphan' },
        { code: 'I4_CHILD_OUTSIDE_PARENT', detail: 'late' },
      ]),
    )
    expect(codes.some((c) => c.detail === 'evt')).toBe(false)
  })

  it('reports a missing trace', () => {
    expect(verifyTraceInvariants('nope', [])).toEqual([
      { code: 'I0_TRACE_MISSING', detail: 'nope' },
    ])
  })
})
