import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index'
import log from 'electron-log'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type SessionStatus = 'running' | 'completed' | 'aborted'

export interface SessionRow {
  id: string
  title: string
  provider_id: string
  model_id: string | null
  workspace: string | null
  agent_id: string
  parent_session_id: string | null
  parent_message_id: string | null
  status: SessionStatus
  metadata: string | null
  created_at: string
  updated_at: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string // JSON SDK content (AssistantContent / UserContent / ToolContent / string)
  content_type: string // 'blocks'
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
  parent_message_id?: string
  status: SessionStatus
  /** 临时元数据（KV）。crystallizer / 子组件用此通道传 session 上下文，不参与持久化语义。 */
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface ChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string // JSON SDK content
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
    parent_message_id: row.parent_message_id ?? undefined,
    status: (row.status as SessionStatus) ?? 'completed',
    metadata: parseMetadata(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cache_read_tokens: row.cache_read_tokens ?? 0,
    cache_write_tokens: row.cache_write_tokens ?? 0,
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
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

export function parseContent(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

export const sessionRepo = {
  list(): ChatSession[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]
    return rows.map(rowToSession)
  },

  create(params: {
    title: string
    provider_id: string
    model_id?: string
    agent_id?: string
    parent_session_id?: string
    parent_message_id?: string
    workspace?: string
    status?: SessionStatus
  }): ChatSession {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()
    const agentId = params.agent_id ?? '__chat__'
    // 顶层 session 默认 'completed'（不参与状态机），子 session 由调用方显式传 'running'。
    const status: SessionStatus = params.status ?? 'completed'
    db.prepare(
      `
      INSERT INTO sessions (id, title, provider_id, model_id, workspace, agent_id, parent_session_id, parent_message_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      params.title,
      params.provider_id,
      params.model_id ?? null,
      params.workspace ?? null,
      agentId,
      params.parent_session_id ?? null,
      params.parent_message_id ?? null,
      status,
      now,
      now,
    )
    log.info(
      '[SessionRepo] Created session:',
      id,
      'agent:',
      agentId,
      params.parent_session_id ? `parent=${params.parent_session_id}` : '',
      `status=${status}`,
    )
    return {
      id,
      title: params.title,
      provider_id: params.provider_id,
      model_id: params.model_id,
      workspace: params.workspace,
      agent_id: agentId,
      parent_session_id: params.parent_session_id,
      parent_message_id: params.parent_message_id,
      status,
      created_at: now,
      updated_at: now,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    }
  },

  /**
   * 读 session.metadata（JSON KV）。crystallizer 等组件读 session 上下文用。
   * 不存在或解析失败返空对象 {}（保守降级，不阻断业务流程）。
   */
  getMetadata(id: string): Record<string, unknown> {
    try {
      const db = getDb()
      const row = db.prepare('SELECT metadata FROM sessions WHERE id = ?').get(id) as
        | { metadata: string | null }
        | undefined
      if (!row) return {}
      return parseMetadata(row.metadata) ?? {}
    } catch (err) {
      log.warn('[SessionRepo] getMetadata failed:', id, err)
      return {}
    }
  },

  /**
   * 写 session.metadata。整体替换语义（不做 deep merge —— 调用方按需 spread 现有值后再传入）。
   * 不存在的 sessionId 静默无操作（按 SQL UPDATE 0 行行为）。
   */
  setMetadata(id: string, metadata: Record<string, unknown>): void {
    const db = getDb()
    const now = new Date().toISOString()
    const json = JSON.stringify(metadata)
    db.prepare('UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?').run(json, now, id)
    log.info('[SessionRepo] Updated metadata:', id, 'keys:', Object.keys(metadata).join(','))
  },

  /**
   * 累加 session 的 token 用量(归一后的非缓存 input / output / 缓存读写)。
   * 增量 UPDATE; fail-open(出错只 warn, 不阻断主流程)。
   */
  addUsage(
    id: string,
    t: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    },
  ): void {
    try {
      getDb()
        .prepare(
          `UPDATE sessions SET
             input_tokens       = input_tokens + ?,
             output_tokens      = output_tokens + ?,
             cache_read_tokens  = cache_read_tokens + ?,
             cache_write_tokens = cache_write_tokens + ?
           WHERE id = ?`,
        )
        .run(t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheWriteTokens, id)
    } catch (err) {
      log.warn('[SessionRepo] addUsage failed:', id, err)
    }
  },

  /**
   * 更新 session 状态。仅用于子 session 终态切换：
   *   'running' → 'completed' | 'aborted'
   * 顶层 session 默认 'completed'，本方法对其无意义但不报错（按 SQL 行为）。
   *
   * 不存在返 null（§E-MUST-2）。
   */
  updateStatus(id: string, status: SessionStatus): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated status:', id, '->', status)
    return this.getById(id)
  },

  updateAgentId(id: string, agentId: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE sessions SET agent_id = ?, updated_at = ? WHERE id = ?')
      .run(agentId, now, id)
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
    const info = db
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, id)
    if (info.changes === 0) return null
    return this.getById(id)
  },

  updateModelAndClearMessages(id: string, model_id: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?')
      .run(model_id, now, id)
    if (info.changes === 0) return null
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    log.info('[SessionRepo] Updated model and cleared messages for session:', id, '->', model_id)
    return this.getById(id)
  },

  updateProvider(id: string, provider_id: string): void {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare('UPDATE sessions SET provider_id = ?, updated_at = ? WHERE id = ?').run(
      provider_id,
      now,
      id,
    )
    log.info('[SessionRepo] Updated provider for session:', id, '->', provider_id)
  },

  updateModel(id: string, model_id: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE sessions SET model_id = ?, updated_at = ? WHERE id = ?')
      .run(model_id, now, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated model for session:', id, '->', model_id)
    return this.getById(id)
  },

  updateWorkspace(id: string, workspace: string): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE sessions SET workspace = ?, updated_at = ? WHERE id = ?')
      .run(workspace, now, id)
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

  /**
   * 查找已为某个 source session 创建过的 workbench session。
   * 用 metadata.source_session_id 反查（不依赖 title / parent_session_id）。
   *
   * 用途：agents:start-crystallize 决定"复用既有"还是"新建"workbench。
   * 不存在返 null。
   */
  findWorkbenchForSource(sourceSessionId: string): ChatSession | null {
    try {
      const db = getDb()
      const row = db
        .prepare(
          `SELECT * FROM sessions
            WHERE agent_id = '__crystallizer__'
              AND json_extract(metadata, '$.source_session_id') = ?
            LIMIT 1`,
        )
        .get(sourceSessionId) as SessionRow | undefined
      return row ? rowToSession(row) : null
    } catch (err) {
      log.warn('[SessionRepo] findWorkbenchForSource failed:', sourceSessionId, err)
      return null
    }
  },

  /**
   * 列出此 session 委托过的子 agent_id 集合（基于结构事实查 child sessions）。
   *
   * 用途：crystallizer 沉淀时把这些 id 写入新 agent profile 的
   * `dependencies.subagents`，让抽出的业务 agent 在新 session 工作时能继续委托。
   *
   * 实现：查 sessions 表中 parent_session_id = sessionId 的所有子 session，
   * 取 distinct agent_id（按首次出现时间排序）。**不依赖 SQL 字符串扫描**——
   * 子 session 行是 delegate_agent.execute 调用的结构事实，零假阳性。
   *
   * 失败时（DB 异常）返回 [] + log.warn（保守降级，不阻塞 crystallizer）。
   */
  listDelegatedAgents(sessionId: string): string[] {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT agent_id, MIN(created_at) AS first_at
             FROM sessions
            WHERE parent_session_id = ?
            GROUP BY agent_id
            ORDER BY first_at ASC`,
        )
        .all(sessionId) as Array<{ agent_id: string }>
      return rows.map((r) => r.agent_id)
    } catch (err) {
      log.warn('[SessionRepo] listDelegatedAgents failed:', sessionId, err)
      return []
    }
  },

  /**
   * 判断 session 历史中是否发生过 delegate_agent 调用。
   *
   * v2 实现：调用 listDelegatedAgents().length > 0（结构事实，零字符串扫描）。
   * 兼容旧调用方；新代码推荐直接用 listDelegatedAgents 拿到具体 id 列表。
   */
  hasDelegation(sessionId: string): boolean {
    return this.listDelegatedAgents(sessionId).length > 0
  },
}

export interface MessageCreateParams {
  id: string
  session_id: string
  role: MessageRole
  content: unknown // SDK content format — AssistantContent / UserContent / ToolContent / string
  agent_id?: string
}

export const messageRepo = {
  listBySession(sessionId: string): ChatMessage[] {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as MessageRow[]
    return rows.map(rowToMessage)
  },

  create(params: MessageCreateParams): ChatMessage {
    const db = getDb()
    const now = new Date().toISOString()
    const contentJson = JSON.stringify(params.content)
    const agentId = params.agent_id ?? '__chat__'
    db.prepare(
      `
      INSERT INTO messages (id, session_id, role, content, content_type, agent_id, created_at)
      VALUES (?, ?, ?, ?, 'blocks', ?, ?)
    `,
    ).run(params.id, params.session_id, params.role, contentJson, agentId, now)
    return {
      id: params.id,
      session_id: params.session_id,
      role: params.role,
      content: contentJson,
      agent_id: agentId,
      created_at: now,
    }
  },

  /**
   * 批量写入，所有行在同一事务里落盘。
   *
   * ReAct 循环每步会同时写 assistant(tool_use) + tool(result) 两行——两者必须
   * 成对出现，否则 SDK 下次 rebuild prompt 时会抛 "Every tool_use must have a
   * tool_result"，整个 session 废掉。单次 create 的话，两次 write 之间若进程
   * 崩溃就会出现孤儿 tool_use；用事务把两行绑定为原子操作。
   */
  createBatch(items: MessageCreateParams[]): ChatMessage[] {
    if (items.length === 0) return []
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO messages (id, session_id, role, content, content_type, agent_id, created_at)
      VALUES (?, ?, ?, ?, 'blocks', ?, ?)
    `)
    const rows: ChatMessage[] = []
    const tx = db.transaction((batch: MessageCreateParams[]) => {
      const now = new Date().toISOString()
      for (const params of batch) {
        const contentJson = JSON.stringify(params.content)
        const agentId = params.agent_id ?? '__chat__'
        stmt.run(params.id, params.session_id, params.role, contentJson, agentId, now)
        rows.push({
          id: params.id,
          session_id: params.session_id,
          role: params.role,
          content: contentJson,
          agent_id: agentId,
          created_at: now,
        })
      }
    })
    tx(items)
    return rows
  },

  deleteBySession(sessionId: string): void {
    const db = getDb()
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  },
}
