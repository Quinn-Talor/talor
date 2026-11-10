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
import { agentFor } from './agents'
import { catalogSnapshot } from './catalog'
import { createRuntime } from './engine'
import { INTERRUPTED_NOTE, rowsOfRun } from './turn-rows'

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
  it('AC-007 shows an interrupted notice for a run the archive left unfinished', async () => {
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
    // 引擎创建时给没结束的运行补记中断结局；界面的提示行由读模型从结局折叠，不写 messages 表
    expect((await second.engine.interrupted()).map((r) => r.runId)).toEqual(['m1'])
    const rows = await rowsOfRun(archiveB, { runId: 'm1', sessionId: 's1', agentId: '__chat__' })
    expect(rows.at(-1)).toMatchObject({ id: 'm1:notice', content_type: 'notice', trace_id: 'm1' })
    expect(JSON.parse(rows.at(-1)!.content)).toEqual([{ type: 'text', text: INTERRUPTED_NOTE }])
    await first.engine.shutdown()
    await second.engine.shutdown()
  })
})
