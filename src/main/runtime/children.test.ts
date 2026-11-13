import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))

import log from 'electron-log'
import type { RunEvent, RunUsage } from '@talor/agent-engine'
import type { AgentProfile } from '@shared/types/agent'
import type { ChatCallbacks } from '../chat/types'
import { engineAgentId } from './agents'
import { childSessionStatusOf, childTitleOf, createRunTreeProjection, ownUsageOf } from './children'
import { liveRows } from './live-turns'
import { phaseMarker } from '@shared/turn-phase'

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

const HELPER: AgentProfile = {
  id: 'helper',
  name: 'Helper',
  description: 'helps',
  agentPrompt: 'x',
}
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

function usage(total = ZERO, children = ZERO): RunUsage {
  return { ...total, main: total, memory: ZERO, supervision: ZERO, children } as RunUsage
}

const blobs = new Map<string, string>()

function started(runId: string, parentRunId: string | undefined, task: string, agent = HELPER.id) {
  const ref = `sha256:${runId}`
  blobs.set(
    ref,
    JSON.stringify({
      input: [{ role: 'user', parts: [{ type: 'text', text: task }] }],
      history: [],
    }),
  )
  return {
    t: 'run_started',
    seq: 1,
    at: 1,
    agent: { id: engineAgentId(agent), fingerprint: 'f' },
    task: { fingerprint: 't', subject: 's1', content: ref },
    model: 'talor:p1/m1',
    ...(parentRunId ? { parentRunId } : {}),
    rootRunId: 'm',
  } as unknown as RunEvent
}

const responded = (text: string) =>
  ({
    t: 'model_responded',
    seq: 2,
    at: 2,
    step: 1,
    response: { text, toolCalls: [] },
  }) as unknown as RunEvent
const stepEnded = { t: 'step_ended', seq: 3, at: 3, step: 1 } as unknown as RunEvent
const ended = (status: string, u = usage()) =>
  ({ t: 'run_ended', seq: 4, at: 4, result: { status, usage: u } }) as unknown as RunEvent

function callbacks(): ChatCallbacks {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onMessagePersisted: vi.fn(),
    onDone: vi.fn(),
  }
}

function projection(cb = callbacks()) {
  return {
    cb,
    p: createRunTreeProjection({
      sessionId: 's1',
      messageId: 'm',
      agentId: '__chat__',
      callbacks: cb,
      getBlob: async (ref) => blobs.get(ref) ?? '',
      profileOf: (id) => (id === engineAgentId(HELPER.id) ? HELPER : undefined),
    }),
  }
}

async function feed(p: ReturnType<typeof projection>['p'], runId: string, events: RunEvent[]) {
  for (const e of events) await p.subscriber.onEvent?.(e, { runId })
}

const db = () => currentDb.instance!
const sessions = () =>
  db().prepare('SELECT * FROM sessions ORDER BY created_at, rowid').all() as Array<
    Record<string, unknown>
  >
beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  db().exec(CREATE_TABLES)
  db()
    .prepare(
      `INSERT INTO sessions (id, title, provider_id, model_id, workspace, created_at, updated_at)
       VALUES ('s1', 't', 'p1', 'm1', '/w', '2026-10-31', '2026-10-31')`,
    )
    .run()
  blobs.clear()
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('child session helpers', () => {
  it('AC-007 maps run outcomes to session status and subtracts child usage', () => {
    expect(
      ['failed', 'aborted', 'stopped', 'finalized', 'awaiting_input', 'completed'].map((s) =>
        childSessionStatusOf(s as never),
      ),
    ).toEqual(['aborted', 'aborted', 'completed', 'completed', 'completed', 'completed'])
    expect(
      ownUsageOf(
        usage(
          { input: 30, output: 12, cacheRead: 5, cacheWrite: 0 },
          { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
        ),
      ),
    ).toEqual({ inputTokens: 20, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0 })
    expect(childTitleOf('Helper', 'a'.repeat(41))).toBe(`Helper: ${'a'.repeat(40)}...`)
    expect(childTitleOf('Helper', '整理笔记')).toBe('Helper: 整理笔记')
  })
})

describe('createRunTreeProjection', () => {
  it('AC-007 projects a child run into a child session without writing messages', async () => {
    const { p } = projection()
    await feed(p, 'c1', [started('c1', 'm', '整理笔记'), responded('已整理'), stepEnded])
    await p.idle()

    const running = sessions().find((s) => s.parent_session_id === 's1')!
    // 运行中：子会话的行来自子运行的折叠（进行中的轮）
    expect(
      liveRows(running.id as string).map((r) => ({
        role: r.role,
        content: JSON.parse(r.content) as unknown,
        trace_id: r.trace_id,
      })),
    ).toEqual([
      { role: 'user', content: '整理笔记', trace_id: 'c1' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '已整理', providerOptions: phaseMarker('answer') }],
        trace_id: 'c1',
      },
    ])

    await feed(p, 'c1', [ended('completed')])
    await p.idle()

    const child = sessions().find((s) => s.parent_session_id === 's1')!
    expect(child).toMatchObject({
      parent_message_id: 'm',
      agent_id: 'helper',
      title: 'Helper: 整理笔记',
      provider_id: 'p1',
      model_id: 'm1',
      workspace: '/w',
      status: 'completed',
    })
    expect(JSON.parse(child.metadata as string)).toMatchObject({ engine_run_id: 'c1' })
    // 结束后由档案按 engine_run_id 读出；不写 messages 表
    expect(liveRows(child.id as string)).toEqual([])
  })

  it('AC-007 closes the child session with its status and own usage', async () => {
    const statuses: string[] = []
    for (const status of ['failed', 'aborted', 'stopped', 'finalized', 'awaiting_input']) {
      const { p } = projection()
      const runId = `c-${status}`
      const u = usage(
        { input: 30, output: 12, cacheRead: 5, cacheWrite: 0 },
        { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
      )
      await feed(p, runId, [started(runId, 'm', status), ended(status, u)])
      await p.idle()
      const child = sessions().find((s) => s.title === `Helper: ${status}`)!
      statuses.push(child.status as string)
      expect(child).toMatchObject({
        input_tokens: 20,
        output_tokens: 10,
        cache_read_tokens: 5,
        cache_write_tokens: 0,
      })
    }
    expect(statuses).toEqual(['aborted', 'aborted', 'completed', 'completed', 'completed'])
  })

  it('A5b AC-004 records a child run per step without counting it twice', async () => {
    const { p } = projection()
    const step = (n: number, input: number, output: number) =>
      ({
        t: 'model_responded',
        seq: 2,
        at: 2,
        step: n,
        response: {
          text: `s${n}`,
          toolCalls: [],
          usage: { input, output, cacheRead: 0, cacheWrite: 0 },
        },
      }) as unknown as RunEvent
    const total = usage(
      { input: 16 + 7, output: 6 + 1, cacheRead: 0, cacheWrite: 0 },
      { input: 7, output: 1, cacheRead: 0, cacheWrite: 0 },
    )
    await feed(p, 'c1', [
      started('c1', 'm', 'two steps'),
      step(1, 10, 4),
      { t: 'step_ended', seq: 3, at: 3, step: 1 } as unknown as RunEvent,
      step(2, 6, 2),
      ended('completed', total),
    ])
    await p.idle()
    const child = sessions().find((s) => s.title === 'Helper: two steps')!
    expect(child).toMatchObject({ input_tokens: 16, output_tokens: 6 })
    // 根投影没有收到任何事件，没有记录用量
    expect(p.recordedUsage()).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(sessions().find((s) => s.id === 's1')).toMatchObject({ input_tokens: 0 })
  })

  it('AC-008 nests grandchildren, drops unknown parents and keeps child notices silent', async () => {
    const { p, cb } = projection()
    vi.mocked(log.warn).mockClear()
    await feed(p, 'c1', [started('c1', 'm', 'outer')])
    await feed(p, 'g1', [started('g1', 'c1', 'inner')])
    await feed(p, 'x1', [started('x1', 'nope', 'lost'), responded('lost'), stepEnded])
    p.subscriber.onNotice?.({ t: 'text_delta', step: 1, text: 'child' }, { runId: 'c1' })
    await p.subscriber.onEvent?.(responded('root'), { runId: 'm' })
    p.subscriber.onNotice?.({ t: 'text_delta', step: 1, text: 'root' }, { runId: 'm' })
    await feed(p, 'g1', [ended('completed')])
    await feed(p, 'c1', [ended('completed')])
    await p.idle()

    const outer = sessions().find((s) => s.title === 'Helper: outer')!
    const inner = sessions().find((s) => s.title === 'Helper: inner')!
    expect(outer.parent_session_id).toBe('s1')
    expect(inner).toMatchObject({ parent_session_id: outer.id, parent_message_id: 'c1' })
    expect(sessions().some((s) => s.title === 'Helper: lost')).toBe(false)
    expect(vi.mocked(log.warn)).toHaveBeenCalled()
    expect(cb.onTextDelta).toHaveBeenCalledTimes(1)
    expect(cb.onTextDelta).toHaveBeenCalledWith('m', 'root', 1)
  })
})
