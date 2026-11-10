import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index'
import log from 'electron-log'
import type { ReasoningConfig } from '@shared/types/models'

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
  reasoning: string | null
  created_at: string
  updated_at: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
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
  /** 本会话的推理深度覆盖；未设置时 fallback 到 provider.reasoning。 */
  reasoning?: ReasoningConfig
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
  trace_id?: string
  /** 'notice'：给用户看、不进模型输入的提示消息；普通消息没有这个字段。 */
  content_type?: 'notice'
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
    reasoning: parseReasoning(row.reasoning),
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

function parseReasoning(raw: string | null | undefined): ReasoningConfig | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.enabled === 'boolean') {
      return parsed as ReasoningConfig
    }
    return undefined
  } catch {
    return undefined
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

  updateReasoning(id: string, reasoning: ReasoningConfig): ChatSession | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE sessions SET reasoning = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(reasoning), now, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated reasoning for session:', id)
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

  /** 删除会话及其全部委托子孙会话（parent_session_id 无外键，需显式递归）。 */
  /** 会话及其全部子孙会话的 id（delete 删除的就是这些）。 */
  subtreeIds(id: string): string[] {
    const rows = getDb()
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM sessions WHERE id = ?
           UNION SELECT s.id FROM sessions s JOIN tree t ON s.parent_session_id = t.id
         )
         SELECT id FROM tree`,
      )
      .all(id) as Array<{ id: string }>
    return rows.map((r) => r.id)
  },

  delete(id: string): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM sessions WHERE id = ?
           UNION SELECT s.id FROM sessions s JOIN tree t ON s.parent_session_id = t.id
         )
         DELETE FROM sessions WHERE id IN (SELECT id FROM tree)`,
      ).run(id)
    })()
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
