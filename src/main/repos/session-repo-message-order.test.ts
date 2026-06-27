// 回归守护:listBySession 排序必须保证 tool_use ↔ tool_result 的配对顺序。
//
// 根因(§4.2 配对不变量):createBatch 给同批 assistant(tool_use) + tool(result)
// 盖**同一个** created_at。listBySession 若只 `ORDER BY created_at ASC`,这对消息
// 的相对顺序由 SQLite 任意决定,可能把 tool(result) 排到 tool_use 之前 →
// AI SDK 抛 AI_MissingToolResultsError(v7 严格校验下是硬错误,v6 曾默默容忍)。
// 修法:二级排序 `rowid ASC`(单调插入序 = createBatch 的配对序)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

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

const CREATE_MESSAGES = `
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'blocks',
  agent_id     TEXT NOT NULL DEFAULT '__chat__',
  created_at   TEXT NOT NULL
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
