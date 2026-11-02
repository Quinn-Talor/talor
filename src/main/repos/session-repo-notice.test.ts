// 提示消息（content_type 'notice'）：可指定 created_at 落库，读出时带 content_type，按时间排序。
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
  created_at   TEXT NOT NULL,
  trace_id     TEXT
);
`

beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_MESSAGES)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('notice messages', () => {
  it('AC-005 stores a notice at the given time and reads its content type back', () => {
    messageRepo.create({ id: 'u1', session_id: 's1', role: 'user', content: 'hi', trace_id: 'r1' })
    const created = messageRepo.create({
      id: 'n1',
      session_id: 's1',
      role: 'assistant',
      content: [{ type: 'text', text: 'notice' }],
      content_type: 'notice',
      created_at: '2000-01-01T00:00:00.000Z',
      trace_id: 'r1',
    })
    expect(created).toMatchObject({
      content_type: 'notice',
      created_at: '2000-01-01T00:00:00.000Z',
    })

    const rows = messageRepo.listBySession('s1')
    expect(rows.map((r) => r.id)).toEqual(['n1', 'u1'])
    expect(rows[0]).toMatchObject({
      content_type: 'notice',
      created_at: '2000-01-01T00:00:00.000Z',
    })
    expect(rows[1]).not.toHaveProperty('content_type')
  })
})
