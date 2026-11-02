// A5a：启动引擎、中断收尾、退出关闭。数据库用 :memory:，引擎用桩。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))
vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: () => undefined, getDelegation: () => ({}) }) },
}))

import log from 'electron-log'
import type { RunSummary } from 'agent-engine'
import { messageRepo } from '../repos/session-repo'
import { getRuntime, shutdownRuntime, type Runtime } from './engine'
import {
  INTERRUPTED_NOTE,
  recoverInterruptedRuns,
  shutdownForQuit,
  startEngineRuntime,
} from './lifecycle'

const CREATE_TABLES = `
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
  reasoning TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'blocks',
  agent_id     TEXT NOT NULL DEFAULT '__chat__',
  created_at   TEXT NOT NULL,
  trace_id     TEXT
);
`

const T0 = '2026-10-31T01:00:00.000Z'

function insertSession(id: string, agentId = 'helper') {
  currentDb
    .instance!.prepare(
      `INSERT INTO sessions (id, title, provider_id, agent_id, created_at, updated_at)
       VALUES (?, 't', 'p1', ?, ?, ?)`,
    )
    .run(id, agentId, T0, T0)
}

function insertMessage(
  id: string,
  session: string,
  role: string,
  content: unknown,
  trace: string,
  at: string,
) {
  currentDb
    .instance!.prepare(
      `INSERT INTO messages (id, session_id, role, content, agent_id, created_at, trace_id)
       VALUES (?, ?, ?, ?, 'helper', ?, ?)`,
    )
    .run(id, session, role, JSON.stringify(content), at, trace)
}

const summary = (patch: Partial<RunSummary>): RunSummary =>
  ({ runId: 'r', rootRunId: 'r', startedAt: Date.parse(T0), steps: 0, ...patch }) as RunSummary

const runtimeWith = (interrupted: () => Promise<RunSummary[]>) =>
  ({ engine: { interrupted } }) as unknown as Runtime

beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_TABLES)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('startEngineRuntime', () => {
  it('AC-004 does nothing when off, otherwise warms up then recovers', async () => {
    const calls: string[] = []
    const deps = (mode: 'off' | 'auto') => ({
      mode: () => mode,
      warmUp: () => void calls.push('warmUp'),
      runtime: () => ({}) as Runtime,
      recover: async () => {
        calls.push('recover')
        return 0
      },
    })
    await startEngineRuntime(deps('off'))
    expect(calls).toEqual([])
    await startEngineRuntime(deps('auto'))
    expect(calls).toEqual(['warmUp', 'recover'])
  })
})

describe('recoverInterruptedRuns', () => {
  it('AC-006 marks unfinished top-level runs after their last row', async () => {
    insertSession('s1')
    insertMessage('u1', 's1', 'user', 'go', 'r1', '2026-10-31T01:00:01.000Z')
    insertMessage(
      'a1',
      's1',
      'assistant',
      [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: {} }],
      'r1',
      '2026-10-31T01:00:02.000Z',
    )
    insertMessage(
      't1',
      's1',
      'tool',
      [{ type: 'tool-result', toolCallId: 'c1' }],
      'r1',
      '2026-10-31T01:00:02.000Z',
    )
    insertMessage('u5', 's1', 'user', 'again', 'r5', '2026-10-31T01:00:03.000Z')
    insertMessage(
      'a5',
      's1',
      'assistant',
      [{ type: 'text', text: 'done' }],
      'r5',
      '2026-10-31T01:00:04.000Z',
    )

    const r6Start = Date.parse('2026-10-31T01:00:05.000Z')
    const n = await recoverInterruptedRuns(
      runtimeWith(async () => [
        summary({ runId: 'r1', subject: 's1' }),
        summary({ runId: 'r2', subject: 's1', parentRunId: 'r1' }),
        summary({ runId: 'r3', subject: 'gone' }),
        summary({ runId: 'r4' }),
        summary({ runId: 'r5', subject: 's1' }),
        summary({ runId: 'r6', subject: 's1', startedAt: r6Start }),
      ]),
    )

    expect(n).toBe(2)
    const notices = messageRepo.listBySession('s1').filter((m) => m.content_type === 'notice')
    expect(notices.map((m) => [m.trace_id, m.agent_id, m.created_at])).toEqual([
      ['r1', 'helper', '2026-10-31T01:00:02.000Z'],
      ['r6', 'helper', new Date(r6Start).toISOString()],
    ])
    expect(JSON.parse(notices[0]!.content)).toEqual([{ type: 'text', text: INTERRUPTED_NOTE }])
    // 紧跟 r1 的最后一行，排在 r5 之前
    const order = messageRepo.listBySession('s1').map((m) => m.id)
    expect(order.indexOf('t1')).toBeLessThan(order.indexOf(notices[0]!.id))
    expect(order.indexOf(notices[0]!.id)).toBeLessThan(order.indexOf('u5'))
  })

  it('AC-006 returns 0 with a warning when interrupted() rejects', async () => {
    vi.mocked(log.warn).mockClear()
    const n = await recoverInterruptedRuns(
      runtimeWith(async () => {
        throw new Error('archive closed')
      }),
    )
    expect(n).toBe(0)
    expect(vi.mocked(log.warn)).toHaveBeenCalled()
  })
})

describe('shutdownForQuit', () => {
  afterEach(async () => {
    await shutdownRuntime()
  })

  const install = (shutdown: () => Promise<void>) =>
    getRuntime({ build: () => ({ engine: { shutdown } }) as unknown as Runtime })

  it('AC-009 returns none without an engine', async () => {
    expect(await shutdownForQuit(50)).toBe('none')
  })

  it('AC-009 waits for the engine and the turns in progress', async () => {
    const order: string[] = []
    install(async () => void order.push('engine'))
    let finish!: () => void
    const turn = new Promise<void>((resolve) => (finish = resolve)).then(
      () => void order.push('turn'),
    )
    setTimeout(() => finish(), 20)
    expect(await shutdownForQuit(1000, { waitForTurns: () => turn })).toBe('closed')
    expect(order).toEqual(['engine', 'turn'])
  })

  it('AC-009 gives up after the timeout', async () => {
    install(() => new Promise<void>(() => undefined))
    const started = Date.now()
    expect(await shutdownForQuit(50)).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
