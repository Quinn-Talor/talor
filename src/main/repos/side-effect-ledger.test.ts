import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }))
vi.mock('../db', () => ({ getDb: mockGetDb }))

import { SideEffectLedger, type SideEffectEntry } from './side-effect-ledger'

const SCHEMA_DDL = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider_id TEXT,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT,
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT,
  metadata TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE side_effect_log (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  parent_session_id   TEXT,
  message_id          TEXT NOT NULL,
  tool_call_id        TEXT NOT NULL,
  step_index          INTEGER NOT NULL,
  op                  TEXT NOT NULL,
  target              TEXT NOT NULL,
  preview             TEXT NOT NULL,
  confirmed_by        TEXT NOT NULL CHECK(confirmed_by IN ('pendingBlock','fallback','memory','auto-low')),
  user_decision       TEXT NOT NULL CHECK(user_decision IN ('approved','denied','auto')),
  created_at          TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_side_effect_session ON side_effect_log(session_id);
CREATE INDEX idx_side_effect_parent ON side_effect_log(parent_session_id);
`

function setupTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_DDL)
  // 预插 session 行避免 FK 违反 (测试用)
  db.prepare(
    `INSERT INTO sessions (id, title, provider_id, model_id, workspace, agent_id, parent_session_id, parent_message_id, status, metadata, created_at, updated_at)
     VALUES (?, '', '', '', '', '__chat__', NULL, NULL, 'completed', '{}', '', '')`,
  ).run('root-session')
  db.prepare(
    `INSERT INTO sessions (id, title, provider_id, model_id, workspace, agent_id, parent_session_id, parent_message_id, status, metadata, created_at, updated_at)
     VALUES (?, '', '', '', '', '__chat__', 'root-session', NULL, 'completed', '{}', '', '')`,
  ).run('child-session')
  return db
}

function makeEntry(overrides: Partial<Omit<SideEffectEntry, 'id' | 'created_at'>> = {}) {
  return {
    session_id: 'root-session',
    parent_session_id: null,
    message_id: 'msg-1',
    tool_call_id: 'tc-1',
    step_index: 1,
    op: 'sql:INSERT',
    target: 'game.rule',
    preview: 'INSERT INTO game.rule ...',
    confirmed_by: 'pendingBlock' as const,
    user_decision: 'approved' as const,
    ...overrides,
  }
}

describe('SideEffectLedger', () => {
  let db: Database.Database
  let ledger: SideEffectLedger

  beforeEach(() => {
    db = setupTestDb()
    mockGetDb.mockReturnValue(db)
    ledger = new SideEffectLedger()
  })

  afterEach(() => {
    db.close()
    vi.clearAllMocks()
  })

  describe('record', () => {
    it('插入一行,返回含 id + created_at 的完整 entry', () => {
      const result = ledger.record(makeEntry())
      expect(result.id).toBeTruthy()
      expect(result.created_at).toBeTruthy()
      expect(result.op).toBe('sql:INSERT')

      const row = db.prepare('SELECT * FROM side_effect_log WHERE id = ?').get(result.id)
      expect(row).toBeDefined()
    })

    it('confirmed_by 非法值 → CHECK 约束 throw', () => {
      expect(() => ledger.record(makeEntry({ confirmed_by: 'invalid' as never }))).toThrow()
    })

    it('user_decision 非法值 → CHECK 约束 throw', () => {
      expect(() => ledger.record(makeEntry({ user_decision: 'whatever' as never }))).toThrow()
    })
  })

  describe('listByRootSession', () => {
    it('返回直接 session_id 匹配的 entry', () => {
      ledger.record(makeEntry({ tool_call_id: 'a' }))
      ledger.record(makeEntry({ tool_call_id: 'b' }))
      const list = ledger.listByRootSession('root-session')
      expect(list).toHaveLength(2)
    })

    it('聚合子 session (parent_session_id 匹配 root)', () => {
      ledger.record(makeEntry({ tool_call_id: 'parent-call' }))
      ledger.record(
        makeEntry({
          session_id: 'child-session',
          parent_session_id: 'root-session',
          tool_call_id: 'child-call',
          op: 'file:write',
        }),
      )
      const list = ledger.listByRootSession('root-session')
      expect(list).toHaveLength(2)
      expect(list.find((e) => e.tool_call_id === 'child-call')).toBeDefined()
    })

    it('sinceStepIndex 过滤 step_index < N 的 entry', () => {
      ledger.record(makeEntry({ tool_call_id: 'a', step_index: 1 }))
      ledger.record(makeEntry({ tool_call_id: 'b', step_index: 5 }))
      ledger.record(makeEntry({ tool_call_id: 'c', step_index: 10 }))
      const list = ledger.listByRootSession('root-session', { sinceStepIndex: 5 })
      expect(list).toHaveLength(2)
      expect(list.map((e) => e.step_index)).toEqual([5, 10])
    })

    it('sinceTime 过滤 created_at < T 的 entry (本 turn 划界)', () => {
      // 这里用 INSERT 直接走 SQL 注入特定 timestamp,绕过 ledger.record 的 new Date()
      const before = '2020-01-01T00:00:00.000Z'
      const turnStart = '2026-05-12T00:00:00.000Z'
      const after = '2026-05-12T00:01:00.000Z'
      db.prepare(
        `INSERT INTO side_effect_log
         (id, session_id, parent_session_id, message_id, tool_call_id, step_index,
          op, target, preview, confirmed_by, user_decision, created_at)
         VALUES (?, 'root-session', NULL, 'm1', ?, 0,
                 'op', 't', 'p', 'pendingBlock', 'approved', ?)`,
      ).run('id-old', 'tc-old', before)
      db.prepare(
        `INSERT INTO side_effect_log
         (id, session_id, parent_session_id, message_id, tool_call_id, step_index,
          op, target, preview, confirmed_by, user_decision, created_at)
         VALUES (?, 'root-session', NULL, 'm1', ?, 0,
                 'op', 't', 'p', 'pendingBlock', 'approved', ?)`,
      ).run('id-new', 'tc-new', after)

      const list = ledger.listByRootSession('root-session', { sinceTime: turnStart })
      expect(list).toHaveLength(1)
      expect(list[0].tool_call_id).toBe('tc-new')
    })

    it('sinceTime + sinceStepIndex 同时给 → AND 关系', () => {
      const turnStart = '2026-05-12T00:00:00.000Z'
      const after = '2026-05-12T00:01:00.000Z'
      db.prepare(
        `INSERT INTO side_effect_log
         (id, session_id, parent_session_id, message_id, tool_call_id, step_index,
          op, target, preview, confirmed_by, user_decision, created_at)
         VALUES (?, 'root-session', NULL, 'm1', ?, ?,
                 'op', 't', 'p', 'pendingBlock', 'approved', ?)`,
      ).run('id-1', 'tc-low-step', 1, after)
      db.prepare(
        `INSERT INTO side_effect_log
         (id, session_id, parent_session_id, message_id, tool_call_id, step_index,
          op, target, preview, confirmed_by, user_decision, created_at)
         VALUES (?, 'root-session', NULL, 'm1', ?, ?,
                 'op', 't', 'p', 'pendingBlock', 'approved', ?)`,
      ).run('id-2', 'tc-high-step', 5, after)

      const list = ledger.listByRootSession('root-session', {
        sinceTime: turnStart,
        sinceStepIndex: 3,
      })
      expect(list).toHaveLength(1)
      expect(list[0].tool_call_id).toBe('tc-high-step')
    })

    it('其他 session 的 entry 不返回', () => {
      // 给另一 root 插一条
      db.prepare(
        `INSERT INTO sessions (id, title, provider_id, model_id, workspace, agent_id, parent_session_id, parent_message_id, status, metadata, created_at, updated_at)
         VALUES (?, '', '', '', '', '__chat__', NULL, NULL, 'completed', '{}', '', '')`,
      ).run('other-session')
      ledger.record(makeEntry({ session_id: 'other-session', tool_call_id: 'x' }))
      ledger.record(makeEntry({ tool_call_id: 'y' }))
      const list = ledger.listByRootSession('root-session')
      expect(list).toHaveLength(1)
      expect(list[0].tool_call_id).toBe('y')
    })
  })

  describe('buildSummary', () => {
    it('空 ledger 返回空字符串', () => {
      expect(ledger.buildSummary('root-session', '2000-01-01T00:00:00.000Z')).toBe('')
    })

    it('单 entry 输出 markdown 摘要,含 op + target + decision', () => {
      ledger.record(
        makeEntry({
          op: 'sql:INSERT',
          target: 'game.rule',
          preview: 'INSERT INTO game.rule (...) VALUES (...)',
          user_decision: 'approved',
          confirmed_by: 'pendingBlock',
        }),
      )
      const summary = ledger.buildSummary('root-session', '2000-01-01T00:00:00.000Z')
      expect(summary).toContain('Side effects this turn')
      expect(summary).toContain('sql:INSERT on game.rule')
      expect(summary).toContain('approved')
      expect(summary).toContain('INSERT INTO game.rule')
    })

    it('approval memory 自动通过 → 标签 "auto via approval memory"', () => {
      ledger.record(
        makeEntry({
          confirmed_by: 'memory',
          user_decision: 'approved',
        }),
      )
      expect(ledger.buildSummary('root-session', '2000-01-01T00:00:00.000Z')).toContain(
        'auto via approval memory',
      )
    })

    it('子 session entry 含 "subagent" 标签 (id 前 8 字符)', () => {
      ledger.record(
        makeEntry({
          session_id: 'child-session',
          parent_session_id: 'root-session',
          op: 'file:write',
          target: '/path/file',
        }),
      )
      const summary = ledger.buildSummary('root-session', '2000-01-01T00:00:00.000Z')
      expect(summary).toMatch(/\(subagent child-se\) ✓ file:write/)
    })

    it('preview 超过 200 字符截断 + 省略号', () => {
      const longPreview = 'A'.repeat(300)
      ledger.record(makeEntry({ preview: longPreview }))
      const summary = ledger.buildSummary('root-session', '2000-01-01T00:00:00.000Z')
      expect(summary).toContain('A'.repeat(200) + '…')
    })

    it('preview 等于 target 时不重复输出 preview 行', () => {
      ledger.record(makeEntry({ preview: 'game.rule', target: 'game.rule' }))
      const summary = ledger.buildSummary('root-session', '2000-01-01T00:00:00.000Z')
      expect(summary.match(/game\.rule/g)?.length).toBe(1)
    })
  })

  describe('clearBySession', () => {
    it('清空指定 session 的所有 entry', () => {
      ledger.record(makeEntry({ tool_call_id: 'a' }))
      ledger.record(makeEntry({ tool_call_id: 'b' }))
      ledger.clearBySession('root-session')
      expect(ledger.listByRootSession('root-session')).toHaveLength(0)
    })

    it('其他 session 的 entry 不受影响', () => {
      db.prepare(
        `INSERT INTO sessions (id, title, provider_id, model_id, workspace, agent_id, parent_session_id, parent_message_id, status, metadata, created_at, updated_at)
         VALUES (?, '', '', '', '', '__chat__', NULL, NULL, 'completed', '{}', '', '')`,
      ).run('other-session')
      ledger.record(makeEntry({ session_id: 'other-session', tool_call_id: 'x' }))
      ledger.record(makeEntry({ tool_call_id: 'y' }))
      ledger.clearBySession('root-session')
      expect(ledger.listByRootSession('root-session')).toHaveLength(0)
      expect(ledger.listByRootSession('other-session')).toHaveLength(1)
    })
  })

  describe('FK CASCADE', () => {
    it('session 删除时 ledger 联动清理', () => {
      ledger.record(makeEntry({ tool_call_id: 'a' }))
      expect(ledger.listByRootSession('root-session')).toHaveLength(1)
      db.prepare('DELETE FROM sessions WHERE id = ?').run('root-session')
      expect(ledger.listByRootSession('root-session')).toHaveLength(0)
    })
  })
})
