import { getDatabase } from './database'
import type { Session, Message } from '../../renderer/types'

export const sessionRepository = {
  findAll(): Session[] {
    const db = getDatabase()
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[]
    return sessions.map(s => ({
      id: s.id,
      title: s.title,
      agentId: s.agent_id,
      messages: this.getMessages(s.id),
      createdAt: s.created_at,
      updatedAt: s.updated_at
    }))
  },

  findById(id: string): Session | null {
    const db = getDatabase()
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any
    if (!session) return null
    return {
      id: session.id,
      title: session.title,
      agentId: session.agent_id,
      messages: this.getMessages(session.id),
      createdAt: session.created_at,
      updatedAt: session.updated_at
    }
  },

  create(session: Session): void {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO sessions (id, title, agent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.id, session.title, session.agentId, session.createdAt, session.updatedAt)
  },

  update(session: Session): void {
    const db = getDatabase()
    db.prepare(`
      UPDATE sessions SET title = ?, agent_id = ?, updated_at = ?
      WHERE id = ?
    `).run(session.title, session.agentId, session.updatedAt, session.id)
  },

  delete(id: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  },

  getMessages(sessionId: string): Message[] {
    const db = getDatabase()
    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[]
    return messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined
    }))
  },

  addMessage(sessionId: string, message: Message): void {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp, tool_calls)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.timestamp,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null
    )
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
  }
}
