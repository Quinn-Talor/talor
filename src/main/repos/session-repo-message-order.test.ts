// 回归守护:listBySession 排序必须保证 tool_use ↔ tool_result 的配对顺序。
//
// 根因(§4.2 配对不变量):createBatch 给同批 assistant(tool_use) + tool(result)
// 盖**同一个** created_at。listBySession 若只 `ORDER BY created_at ASC`,这对消息
// 的相对顺序由 SQLite 任意决定,可能把 tool(result) 排到 tool_use 之前 →
// AI SDK 抛 AI_MissingToolResultsError(v7 严格校验下是硬错误,v6 曾默默容忍)。
// 修法:二级排序 `rowid ASC`(单调插入序 = createBatch 的配对序)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import log from 'electron-log'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))

import { messageRepo } from './session-repo'
import { runInScope } from '../observe/trace-context'

const CREATE_MESSAGES = `
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

const SID = 'sess-order'

describe('messageRepo.listBySession 排序', () => {
  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_MESSAGES)
  })
  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  it('触发:同 created_at 的 tool_use/tool_result,配对顺序保留(assistant 在 tool 前)', () => {
    // createBatch 模拟 react-loop 落 tool-pair:两条同 created_at。
    messageRepo.createBatch([
      {
        id: 'm-assistant',
        session_id: SID,
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call_X', toolName: 'skill', input: {} }],
      },
      {
        id: 'm-tool',
        session_id: SID,
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_X', toolName: 'skill', output: {} }],
      },
    ])

    const msgs = messageRepo.listBySession(SID)
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'tool'])
    // tool_use 必须紧邻在其 tool_result 之前(SDK 配对要求)。
    const ai = msgs.findIndex((m) => m.id === 'm-assistant')
    const ti = msgs.findIndex((m) => m.id === 'm-tool')
    expect(ti).toBe(ai + 1)
  })

  it('不触发:created_at 仍是主排序键(早的在前,即便 rowid 更大)', () => {
    const db = currentDb.instance!
    const ins = db.prepare(
      "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', '[]', ?)",
    )
    // 先插「较晚」时间(rowid=1),再插「较早」时间(rowid=2)→ created_at 主序应让早的在前。
    ins.run('m-late', SID, '2026-01-01T00:00:02.000Z')
    ins.run('m-early', SID, '2026-01-01T00:00:01.000Z')

    const ids = messageRepo.listBySession(SID).map((m) => m.id)
    expect(ids).toEqual(['m-early', 'm-late'])
  })

  it('同 created_at 时按插入序(rowid)稳定返回', () => {
    const db = currentDb.instance!
    const ins = db.prepare(
      "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', '[]', ?)",
    )
    const T = '2026-01-01T00:00:00.000Z'
    ins.run('first', SID, T)
    ins.run('second', SID, T)
    ins.run('third', SID, T)

    expect(messageRepo.listBySession(SID).map((m) => m.id)).toEqual(['first', 'second', 'third'])
  })
})

describe('messageRepo trace_id', () => {
  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_MESSAGES)
  })
  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  function traceIdOf(id: string): string | null {
    return (
      currentDb.instance!.prepare('SELECT trace_id FROM messages WHERE id = ?').get(id) as {
        trace_id: string | null
      }
    ).trace_id
  }

  it('AC-020: messages written inside a trace scope carry its trace_id; outside they stay NULL', () => {
    const scope = { traceId: 't1', parent: { traceId: 't1', observationId: 'root' } }
    runInScope(scope, () => {
      messageRepo.create({ id: 'in-1', session_id: SID, role: 'user', content: 'a' })
      messageRepo.createBatch([
        { id: 'in-2', session_id: SID, role: 'assistant', content: [{ type: 'text', text: 'b' }] },
        { id: 'in-3', session_id: SID, role: 'tool', content: [] },
      ])
    })
    messageRepo.create({ id: 'out-1', session_id: SID, role: 'user', content: 'c' })
    messageRepo.createBatch([
      { id: 'out-2', session_id: SID, role: 'assistant', content: [] },
      { id: 'out-3', session_id: SID, role: 'tool', content: [] },
    ])

    for (const id of ['in-1', 'in-2', 'in-3']) expect(traceIdOf(id)).toBe('t1')
    for (const id of ['out-1', 'out-2', 'out-3']) expect(traceIdOf(id)).toBeNull()

    const listed = messageRepo.listByTrace('t1')
    expect(listed.map((m) => m.id)).toEqual(['in-1', 'in-2', 'in-3'])
    expect(listed.every((m) => m.trace_id === 't1')).toBe(true)
  })

  it('an explicit trace_id overrides the scope; null forces NULL', () => {
    const scope = { traceId: 't1', parent: null }
    runInScope(scope, () => {
      messageRepo.create({ id: 'x-1', session_id: SID, role: 'user', content: 'a', trace_id: 't2' })
      messageRepo.create({ id: 'x-2', session_id: SID, role: 'user', content: 'b', trace_id: null })
    })
    expect(traceIdOf('x-1')).toBe('t2')
    expect(traceIdOf('x-2')).toBeNull()
  })

  it('returned ChatMessage omits trace_id outside a scope (existing callers unchanged)', () => {
    const m = messageRepo.create({ id: 'plain', session_id: SID, role: 'user', content: 'a' })
    expect(m).not.toHaveProperty('trace_id')
    expect(messageRepo.listBySession(SID)[0]).not.toHaveProperty('trace_id')
  })
})

describe('messageRepo.getLastAssistantText', () => {
  const CHILD_SID = 'sess-child'

  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_MESSAGES)
    vi.mocked(log.warn).mockClear()
  })
  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  function insert(id: string, sessionId: string, content: unknown, traceId: string, at: string) {
    currentDb
      .instance!.prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at, trace_id)
         VALUES (?, ?, 'assistant', ?, ?, ?)`,
      )
      .run(id, sessionId, JSON.stringify(content), at, traceId)
  }

  it('returns the newest non-empty assistant text of the trace in this session, skipping tool-only messages', () => {
    insert('m1', SID, [{ type: 'text', text: 'first' }], 't1', '2026-10-19T10:00:01.000Z')
    insert('m2', SID, [{ type: 'text', text: 'final' }], 't1', '2026-10-19T10:00:02.000Z')
    insert('m3', SID, [{ type: 'tool-call', toolCallId: 'c' }], 't1', '2026-10-19T10:00:03.000Z')
    insert('m4', SID, [{ type: 'text', text: 'other trace' }], 't2', '2026-10-19T10:00:04.000Z')
    expect(messageRepo.getLastAssistantText(SID, 't1')).toBe('final')
  })

  it('ignores delegated child-session replies that carry the same trace_id', () => {
    // 父步只有 tool-call(委托),随后该轮中止:最新的带文本消息来自子 session,不能当本轮输出
    insert('p1', SID, [{ type: 'text', text: 'parent intro' }], 't1', '2026-10-19T10:00:01.000Z')
    insert(
      'c1',
      CHILD_SID,
      [{ type: 'text', text: 'child reply' }],
      't1',
      '2026-10-19T10:00:02.000Z',
    )
    insert('p2', SID, [{ type: 'tool-call', toolCallId: 'd' }], 't1', '2026-10-19T10:00:03.000Z')
    expect(messageRepo.getLastAssistantText(SID, 't1')).toBe('parent intro')
  })

  it('returns null when the session has no assistant text in the trace; warns and returns null on read failure', () => {
    insert(
      'c1',
      CHILD_SID,
      [{ type: 'text', text: 'child reply' }],
      't1',
      '2026-10-19T10:00:02.000Z',
    )
    expect(messageRepo.getLastAssistantText(SID, 't1')).toBeNull()

    currentDb.instance!.exec('DROP TABLE messages')
    expect(messageRepo.getLastAssistantText(SID, 't1')).toBeNull()
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
  })
})
