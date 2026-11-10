// agents:start-crystallize（真实 handler）：源会话从引擎会话日志读；工作台的快照与欢迎语写成提示行，
// 快照与推荐模式写成前置输入（引擎会话的前文只来自会话日志）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

const { mockHandle, currentDb, archive } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  currentDb: { instance: null as import('better-sqlite3').Database | null },
  archive: { runs: {} as Record<string, unknown[]>, blobs: {} as Record<string, string> },
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent-talor-test-home' },
  ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) },
}))
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: { list: () => [] } }))
vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))
vi.mock('../runtime/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime/engine')>()),
  runArchive: () => ({
    async query(filter: { session?: string }) {
      return Object.keys(archive.runs)
        .filter((id) => id.startsWith(`${filter.session}:`))
        .map((runId, i) => ({ runId, turn: i + 1 }))
        .reverse()
    },
    async *read(runId: string) {
      for (const e of archive.runs[runId] ?? []) yield e
    },
    async getBlob(ref: string) {
      return archive.blobs[ref]!
    },
  }),
}))

import type { AgentManager } from '../agent/agent-manager'
import { sessionRepo } from '../repos/session-repo'
import { clearRowCache } from '../runtime/turn-rows'
import { registerAgentHandlers } from './agents'

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

/** 源会话的一轮：用户问、助手答。 */
function turn(runId: string, question: string, answer: string) {
  archive.blobs[`in:${runId}`] = JSON.stringify({
    input: [{ role: 'user', parts: [{ type: 'text', text: question }] }],
  })
  archive.runs[runId] = [
    { t: 'run_started', seq: 1, at: 1, task: { content: `in:${runId}` } },
    { t: 'model_responded', seq: 2, at: 2, step: 1, response: { text: answer, toolCalls: [] } },
    { t: 'step_ended', seq: 3, at: 3, step: 1 },
    { t: 'run_ended', seq: 4, at: 4, result: { status: 'completed' } },
  ]
}

function start(sessionId: string) {
  const handle = mockHandle.mock.calls.find((c) => c[0] === 'agents:start-crystallize')![1] as (
    e: unknown,
    raw: { session_id: string },
  ) => Promise<{ success: boolean; workbench_session_id?: string; reused?: boolean }>
  return handle(null, { session_id: sessionId })
}

beforeEach(() => {
  clearRowCache()
  archive.runs = {}
  archive.blobs = {}
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_TABLES)
  currentDb.instance
    .prepare(
      `INSERT INTO sessions (id, title, provider_id, model_id, created_at, updated_at)
       VALUES ('src', '预算讨论', 'p1', 'm1', '2026-11-04', '2026-11-04')`,
    )
    .run()
  mockHandle.mockClear()
  registerAgentHandlers({} as AgentManager)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('agents:start-crystallize on engine sessions', () => {
  it('AC-008 writes the snapshot as notices and pending context', async () => {
    turn('src:1', '预算多少', '预算 58 万元')
    turn('src:2', '几个人', '4 个人')

    const result = await start('src')

    expect(result).toMatchObject({ success: true, reused: false })
    const meta = sessionRepo.getMetadata(result.workbench_session_id!)
    const notices = meta.notices as Array<{ afterTurn: number; role: string; text: string }>
    expect(notices.map((n) => [n.afterTurn, n.role])).toEqual([
      [0, 'user'],
      [0, 'assistant'],
    ])
    expect(notices[0]!.text).toContain('预算 58 万元')
    const pending = meta.pending_context as string[]
    expect(pending).toHaveLength(1)
    expect(pending[0]).toContain('预算 58 万元')
    expect(pending[0]).toContain('默认采用')
    expect(meta.last_snapshot_message_count).toBe(4)
  })

  it('AC-008 appends an updated snapshot when the source has new turns', async () => {
    turn('src:1', '预算多少', '预算 58 万元')
    const first = await start('src')
    const wb = first.workbench_session_id!
    turn('src:2', '几个人', '4 个人')
    clearRowCache()

    const again = await start('src')

    expect(again).toMatchObject({ success: true, reused: true, workbench_session_id: wb })
    const meta = sessionRepo.getMetadata(wb)
    expect((meta.notices as unknown[]).length).toBe(4)
    const pending = meta.pending_context as string[]
    expect(pending).toHaveLength(2)
    expect(pending[1]).toContain('4 个人')
    expect(meta.last_snapshot_message_count).toBe(4)
  })
})
