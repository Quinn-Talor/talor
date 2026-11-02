// A5a 集成：真实引擎与运行档案；数据库 :memory:，模型用 fakeModel。
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

import { defineTask, memoryArchive, modelHub, type RunEvent } from 'agent-engine'
import { fakeModel } from 'agent-engine/testing'
import { messageRepo } from '../repos/session-repo'
import { agentFor } from './agents'
import { catalogSnapshot } from './catalog'
import { createRuntime } from './engine'
import { INTERRUPTED_NOTE, recoverInterruptedRuns } from './lifecycle'

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

const emptyCatalog = () =>
  catalogSnapshot({ builtins: () => [], mcpServers: () => [], skills: () => [], agents: () => [] })

beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_TABLES)
  currentDb.instance
    .prepare(
      `INSERT INTO sessions (id, title, provider_id, agent_id, created_at, updated_at)
       VALUES ('s1', 't', 'p1', '__chat__', ?, ?)`,
    )
    .run(T0, T0)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('interrupted runs (A5a)', () => {
  it('AC-007 marks a run the archive left unfinished', async () => {
    const model = fakeModel({ replies: [{ text: 'ok' }] })
    const archiveA = memoryArchive()
    const first = createRuntime({
      models: modelHub({ providers: [model], default: model.ref }),
      archive: archiveA,
    })
    const agent = agentFor(
      { id: '__chat__', name: 'Talor', description: '', agentPrompt: 'Help.' },
      emptyCatalog(),
    )
    const task = defineTask({
      input: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      subject: 's1',
    })
    const done = await first.interactive.start(agent, task, { runId: 'm1' }).result
    expect(done.status).toBe('completed')

    const head: RunEvent[] = []
    for await (const e of archiveA.read('m1')) {
      if (head.length < 3) head.push(e)
    }
    expect(head.map((e) => e.t)).toEqual(['run_started', 'step_started', 'context_built'])
    const archiveB = memoryArchive()
    await archiveB.append('m1', head)

    const second = createRuntime({
      models: modelHub({ providers: [model], default: model.ref }),
      archive: archiveB,
    })
    expect(await recoverInterruptedRuns(second)).toBe(1)
    const notices = messageRepo.listBySession('s1').filter((m) => m.content_type === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ trace_id: 'm1', agent_id: '__chat__' })
    expect(JSON.parse(notices[0]!.content)).toEqual([{ type: 'text', text: INTERRUPTED_NOTE }])
    await first.engine.shutdown()
    await second.engine.shutdown()
  })
})
