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

import { sessionRepo, messageRepo } from './session-repo'

const CREATE_SESSIONS_FULL = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('running', 'completed', 'aborted')),
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const CREATE_MESSAGES_FULL = `
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'blocks',
  agent_id     TEXT NOT NULL DEFAULT '__chat__',
  created_at   TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

describe('sessionRepo TASK-1 delegation extensions', () => {
  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_SESSIONS_FULL)
  })

  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  describe('create() with delegation fields (AC-014)', () => {
    it('AC-014 (trigger): creates child session with parent_session_id, parent_message_id, status=running', () => {
      const child = sessionRepo.create({
        title: 'Translator: 翻译这段文本到英...',
        provider_id: 'p1',
        model_id: 'openai/gpt-4o',
        agent_id: 'translator-001',
        parent_session_id: 'parent-uuid',
        parent_message_id: 'parent-msg-uuid',
        status: 'running',
        workspace: '/tmp/ws',
      })

      expect(child.id).toBeTruthy()
      expect(child.parent_session_id).toBe('parent-uuid')
      expect(child.parent_message_id).toBe('parent-msg-uuid')
      expect(child.status).toBe('running')
      expect(child.workspace).toBe('/tmp/ws')
      expect(child.agent_id).toBe('translator-001')

      const reread = sessionRepo.getById(child.id)
      expect(reread?.parent_session_id).toBe('parent-uuid')
      expect(reread?.parent_message_id).toBe('parent-msg-uuid')
      expect(reread?.status).toBe('running')
    })

    it('AC-014 (no-trigger): top-level session defaults to status=completed, parent fields NULL', () => {
      const top = sessionRepo.create({
        title: 'Top conversation',
        provider_id: 'p1',
      })

      expect(top.parent_session_id).toBeUndefined()
      expect(top.parent_message_id).toBeUndefined()
      expect(top.status).toBe('completed')

      const reread = sessionRepo.getById(top.id)
      expect(reread?.status).toBe('completed')
    })

    it('rejects invalid status via CHECK constraint', () => {
      // Bypassing TS by casting; CHECK should still reject at SQL layer.
      expect(() =>
        sessionRepo.create({
          title: 'Bad status',
          provider_id: 'p1',
          status: 'invalid' as 'running' | 'completed' | 'aborted',
        }),
      ).toThrow()
    })
  })

  describe('listDelegatedAgents() (TASK-3: AC-027/028)', () => {
    it('AC-027: returns [] when no child sessions exist', () => {
      const session = sessionRepo.create({
        title: 'Empty',
        provider_id: 'p1',
      })
      expect(sessionRepo.listDelegatedAgents(session.id)).toEqual([])
    })

    it('AC-028: returns distinct agent_ids ordered by first occurrence', () => {
      const parent = sessionRepo.create({
        title: 'Parent',
        provider_id: 'p1',
      })
      // 模拟 delegate_agent 创建的子 session 顺序：A → B → A（A 应在 B 前面）
      sessionRepo.create({
        title: 'sub-A-1',
        provider_id: 'p1',
        parent_session_id: parent.id,
        agent_id: 'A',
        status: 'completed',
      })
      sessionRepo.create({
        title: 'sub-B-1',
        provider_id: 'p1',
        parent_session_id: parent.id,
        agent_id: 'B',
        status: 'completed',
      })
      sessionRepo.create({
        title: 'sub-A-2',
        provider_id: 'p1',
        parent_session_id: parent.id,
        agent_id: 'A',
        status: 'completed',
      })

      const result = sessionRepo.listDelegatedAgents(parent.id)
      expect(result).toEqual(['A', 'B']) // distinct + 首次时间排序
    })

    it('hasDelegation backward compat: returns true when child sessions exist', () => {
      const parent = sessionRepo.create({
        title: 'Parent',
        provider_id: 'p1',
      })
      sessionRepo.create({
        title: 'sub',
        provider_id: 'p1',
        parent_session_id: parent.id,
        agent_id: 'X',
        status: 'completed',
      })
      expect(sessionRepo.hasDelegation(parent.id)).toBe(true)
    })

    it('hasDelegation backward compat: returns false when no child sessions', () => {
      const parent = sessionRepo.create({
        title: 'Parent',
        provider_id: 'p1',
      })
      expect(sessionRepo.hasDelegation(parent.id)).toBe(false)
    })
  })

  describe('hasDelegation() (legacy v1 cases — adapted to v2 structural fact)', () => {
    beforeEach(() => {
      currentDb.instance?.exec(CREATE_MESSAGES_FULL)
    })

    it('AC-017 (trigger): returns true when child sessions exist (delegation occurred)', () => {
      const session = sessionRepo.create({
        title: 'Parent with delegation',
        provider_id: 'p1',
      })
      // v2 结构事实：创建一个真实的子 session（模拟 delegate_agent.execute 的产物）
      sessionRepo.create({
        title: 'sub',
        provider_id: 'p1',
        parent_session_id: session.id,
        agent_id: 'translator-001',
        status: 'completed',
      })

      expect(sessionRepo.hasDelegation(session.id)).toBe(true)
    })

    it('AC-018 (no-trigger): returns false when no delegate_agent tool_use in history', () => {
      const session = sessionRepo.create({
        title: 'Worker session',
        provider_id: 'p1',
        agent_id: '__chat__',
      })

      messageRepo.create({
        id: 'm-1',
        session_id: session.id,
        role: 'user',
        content: '帮我读个文件',
        agent_id: '__chat__',
      })
      messageRepo.create({
        id: 'm-2',
        session_id: session.id,
        role: 'assistant',
        content: [
          { type: 'tool_use', toolCallId: 'tc-1', toolName: 'read', input: { path: '/tmp' } },
        ],
        agent_id: '__chat__',
      })

      expect(sessionRepo.hasDelegation(session.id)).toBe(false)
    })

    it('AC-018 (no-trigger): returns false for session with only user message', () => {
      const session = sessionRepo.create({
        title: 'Empty',
        provider_id: 'p1',
      })
      messageRepo.create({
        id: 'm-1',
        session_id: session.id,
        role: 'user',
        content: 'hi',
        agent_id: '__chat__',
      })

      expect(sessionRepo.hasDelegation(session.id)).toBe(false)
    })

    it('AC-018 (no-trigger): returns false for nonexistent sessionId', () => {
      expect(sessionRepo.hasDelegation('nonexistent-id')).toBe(false)
    })

    it('AC-020 (agent-switch robustness): detects delegation via child sessions, not session.agent_id pointer', () => {
      const session = sessionRepo.create({
        title: 'Switched session',
        provider_id: 'p1',
        agent_id: '__chat__',
      })

      // 用户切换过 agent 但子 session 是结构事实 → hasDelegation 看 child sessions
      sessionRepo.create({
        title: 'sub',
        provider_id: 'p1',
        parent_session_id: session.id,
        agent_id: 'translator-001',
        status: 'completed',
      })

      // 后续切回 __chat__ 不影响子 session 表
      sessionRepo.updateAgentId(session.id, '__chat__')
      const reread = sessionRepo.getById(session.id)
      expect(reread?.agent_id).toBe('__chat__')

      // 仍能准确判断（看的是 child sessions 表）
      expect(sessionRepo.hasDelegation(session.id)).toBe(true)
    })

    it('does not false-positive on unrelated message containing tool_use without delegate_agent', () => {
      const session = sessionRepo.create({
        title: 'Other tool',
        provider_id: 'p1',
      })
      messageRepo.create({
        id: 'm-1',
        session_id: session.id,
        role: 'assistant',
        content: [
          { type: 'tool_use', toolCallId: 'tc-1', toolName: 'bash', input: { command: 'ls' } },
        ],
        agent_id: '__chat__',
      })

      expect(sessionRepo.hasDelegation(session.id)).toBe(false)
    })
  })

  describe('getMetadata() / setMetadata() (TASK-1, AC-029)', () => {
    it('AC-029: setMetadata then getMetadata returns identical object', () => {
      const session = sessionRepo.create({
        title: 'Test',
        provider_id: 'p1',
      })
      sessionRepo.setMetadata(session.id, { delegated_subagents: ['A', 'B'] })

      const result = sessionRepo.getMetadata(session.id)
      expect(result).toEqual({ delegated_subagents: ['A', 'B'] })
    })

    it('returns empty object when metadata is NULL', () => {
      const session = sessionRepo.create({
        title: 'No metadata',
        provider_id: 'p1',
      })
      expect(sessionRepo.getMetadata(session.id)).toEqual({})
    })

    it('returns empty object when sessionId does not exist', () => {
      expect(sessionRepo.getMetadata('non-existent-id')).toEqual({})
    })

    it('returns empty object when metadata is corrupted JSON', () => {
      const session = sessionRepo.create({
        title: 'Corrupted',
        provider_id: 'p1',
      })
      // 直接用底层 SQL 写入坏数据
      currentDb
        .instance!.prepare('UPDATE sessions SET metadata = ? WHERE id = ?')
        .run('not-json-{]', session.id)
      expect(sessionRepo.getMetadata(session.id)).toEqual({})
    })

    it('rowToSession includes metadata in returned ChatSession', () => {
      const session = sessionRepo.create({
        title: 'With metadata',
        provider_id: 'p1',
      })
      sessionRepo.setMetadata(session.id, { delegated_subagents: ['X'] })

      const reread = sessionRepo.getById(session.id)
      expect(reread?.metadata).toEqual({ delegated_subagents: ['X'] })
    })
  })

  describe('updateStatus() (AC-015 helper)', () => {
    it('updates status from running to completed', () => {
      const child = sessionRepo.create({
        title: 'Sub running',
        provider_id: 'p1',
        parent_session_id: 'main-1',
        status: 'running',
      })

      const updated = sessionRepo.updateStatus(child.id, 'completed')
      expect(updated?.status).toBe('completed')

      const reread = sessionRepo.getById(child.id)
      expect(reread?.status).toBe('completed')
    })

    it('updates status from running to aborted', () => {
      const child = sessionRepo.create({
        title: 'Sub running',
        provider_id: 'p1',
        parent_session_id: 'main-1',
        status: 'running',
      })

      const updated = sessionRepo.updateStatus(child.id, 'aborted')
      expect(updated?.status).toBe('aborted')
    })

    it('returns null when session does not exist (§E-MUST-2)', () => {
      const result = sessionRepo.updateStatus('nonexistent-id', 'completed')
      expect(result).toBeNull()
    })
  })
})
