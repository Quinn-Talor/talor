import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index'
import log from 'electron-log'
import type { ContentBlock } from '@shared/types/message'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface SessionRow {
  id: string
  title: string
  provider_id: string
  model_id: string | null
  workspace: string | null
  agent_id: string
  parent_session_id: string | null
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string        // JSON ContentBlock[]
  content_type: string   // 'blocks'
  agent_id: string
  created_at: string
}

export interface ChatSession {
  id: string
  title: string
  provider_id: string
  model_id?: string
  workspace?: string
  agent_id: string
  parent_session_id?: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string        // JSON ContentBlock[]
  agent_id: string
  created_at: string
}

function rowToSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    provider_id: row.provider_id,
    model_id: row.model_id ?? undefined,
    workspace: row.workspace ?? undefined,
    agent_id: row.agent_id ?? '__chat__',
    parent_session_id: row.parent_session_id ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    agent_id: row.agent_id ?? '__chat__',
    created_at: row.created_at,
  }
}

export function parseBlocks(content: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed as ContentBlock[]
    return [{ type: 'text', text: String(content) }]
  } catch {
    return [{ type: 'text', text: String(content) }]
  }
}

export const sessionRepo = {
  list(): ChatSession[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]
    return rows.map(rowToSession)
  },

  create(params: { title: string; provider_id: string; model_id?: string; agent_id?: string; parent_session_id?: string }): ChatSession {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()
    const agentId = params.agent_id ?? '__chat__'
    db.prepare(`
      INSERT INTO sessions (id, title, provider_id, model_id, agent_id, parent_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.title, params.provider_id, params.model_id ?? null, agentId, params.parent_session_id ?? null, now, now)
    log.info('[SessionRepo] Created session:', id, 'agent:', agentId)
    return { id, title: params.title, provider_id: params.provider_id, model_id: params.model_id, agent_id: agentId, parent_session_id: params.parent_session_id, created_at: now, updated_at: now }
  },

  updateAgentId(id: string, agentId: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db.prepare('UPDATE sessions SET agent_id = ?, updated_at = ? WHERE id = ?').run(agentId, now, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated agent_id for session:', id, '->', agentId)
    return this.getById(id)
  },

  getById(id: string): ChatSession | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    return row ? rowToSession(row) : null
  },

  rename(id: string, title: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id)
    if (info.changes === 0) return null
    return this.getById(id)
  },

  updateModelAndClearMessages(id: string, model_id: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db.prepare('UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?').run(model_id, now, id)
    if (info.changes === 0) return null
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    log.info('[SessionRepo] Updated model and cleared messages for session:', id, '->', model_id)
    return this.getById(id)
  },

  updateModel(id: string, model_id: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db.prepare('UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?').run(model_id, now, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated model for session:', id, '->', model_id)
    return this.getById(id)
  },

  updateWorkspace(id: string, workspace: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db.prepare('UPDATE sessions SET workspace = ?, updated_at = ? WHERE id = ?').run(workspace, now, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated workspace for session:', id, '->', workspace)
    return this.getById(id)
  },

  touch(id: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, id)
  },

  delete(id: string): void {
    const db = getDb()
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    log.info('[SessionRepo] Deleted session:', id)
  },
}

export const messageRepo = {
  listBySession(sessionId: string): ChatMessage[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as MessageRow[]
    return rows.map(rowToMessage)
  },

  create(params: { id: string; session_id: string; role: MessageRole; content: ContentBlock[]; agent_id?: string }): ChatMessage {
    const db = getDb()
    const now = new Date().toISOString()
    const contentJson = JSON.stringify(params.content)
    const agentId = params.agent_id ?? '__chat__'
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, content_type, agent_id, created_at)
      VALUES (?, ?, ?, ?, 'blocks', ?, ?)
    `).run(params.id, params.session_id, params.role, contentJson, agentId, now)
    return { id: params.id, session_id: params.session_id, role: params.role, content: contentJson, agent_id: agentId, created_at: now }
  },

  deleteBySession(sessionId: string): void {
    const db = getDb()
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  },
}
