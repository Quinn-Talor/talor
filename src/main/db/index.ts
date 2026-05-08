import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import log from 'electron-log'

const CREATE_SESSIONS = `
CREATE TABLE IF NOT EXISTS sessions (
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

const CREATE_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    role         TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content      TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'blocks',
    agent_id     TEXT NOT NULL DEFAULT '__chat__',
    created_at   TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

const CREATE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
`

const CREATE_MCP_SERVERS = `
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('stdio', 'http')),
    command TEXT,
    args TEXT,
    env TEXT,
    url TEXT,
    auth TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`

const CREATE_SESSION_SUMMARIES = `
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id     TEXT NOT NULL PRIMARY KEY,
  summary_text   TEXT NOT NULL,
  covered_until  TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

/**
 * account_keys — 用户声明的第三方服务凭据(飞书 / GitHub / 自定义 skill 等)。
 * 替代旧的 ~/.talor/accounts.json。
 *
 * 一个 service 有多个 key;每个 key 可选 secret 标志。非 secret 字段明文存 value,
 * secret 字段走 safeStorage 加密后 base64 存 value,并把 is_encrypted 置 1。
 * 密文和明文共用 value 列,由 is_encrypted 区分读取路径(保持简单,避免双列)。
 */
const CREATE_ACCOUNT_KEYS = `
CREATE TABLE IF NOT EXISTS account_keys (
  service      TEXT NOT NULL,
  key_name     TEXT NOT NULL,
  value        TEXT NOT NULL,
  is_secret    INTEGER NOT NULL DEFAULT 0,
  is_encrypted INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (service, key_name)
);
`

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('ChatDB not initialized. Call initChatDb() first.')
  }
  return db
}

export function initChatDb(): Database.Database {
  if (db) return db

  const dir = join(app.getPath('home'), '.talor')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const dbPath = join(dir, 'chat.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Drop outdated sessions/messages tables before CREATE.
  // Per project decision: do NOT preserve historical session data when schema
  // changes. Schema is the source of truth; old data is wiped on upgrade.
  recreateSessionsIfOutdated(db)

  db.exec(CREATE_SESSIONS)
  db.exec(CREATE_MESSAGES)
  db.exec(CREATE_INDEX)
  db.exec(CREATE_MCP_SERVERS)
  db.exec(CREATE_SESSION_SUMMARIES)
  db.exec(CREATE_ACCOUNT_KEYS)

  // Cleanup orphan running sub-sessions left from previous crashed runs.
  cleanupOrphanRunningSubSessions(db)

  // 注：crystallizer 工作台 session 不在启动期清理。产品决策：派生 session 永久保留。
  // 即便 source S1 被用户删除，对应 workbench 仍在 DB 里（前端通过
  // agent_id !== '__crystallizer__' 过滤，用户不感知）。这避免了"事后兜底"机制，
  // 且保留了用户跟 crystallizer 的多轮对话 + workbench.metadata.created_agents。

  log.info('[ChatDB] Initialized at:', dbPath, 'WAL mode enabled')
  return db
}

/**
 * 检查 sessions / messages 表是否符合最新 schema；任一表 outdated（必需列
 * 缺失）则**连同两表一起 DROP**，让后续 `CREATE TABLE IF NOT EXISTS` 重建为
 * 干净的最新 schema。
 *
 * 设计决策：**不保留历史 session 数据**。schema 是 source of truth，
 * 升级时旧数据直接丢弃。messages 通过 FK 依赖 sessions，drop 顺序：
 * messages 先于 sessions。
 *
 * 必需列清单与各 CREATE_* DDL 同步；任一列缺失即触发重建。
 *
 * 全新数据库（两表都不存在）走 IF NOT EXISTS 创建路径，本函数 no-op。
 */
export function recreateSessionsIfOutdated(db: Database.Database): void {
  const sessionsRequiredCols = [
    'id',
    'title',
    'provider_id',
    'model_id',
    'workspace',
    'agent_id',
    'parent_session_id',
    'parent_message_id',
    'status',
    'metadata',
    'created_at',
    'updated_at',
  ]
  const messagesRequiredCols = [
    'id',
    'session_id',
    'role',
    'content',
    'content_type',
    'agent_id',
    'created_at',
  ]

  const sessionsMissing = collectMissingCols(db, 'sessions', sessionsRequiredCols)
  const messagesMissing = collectMissingCols(db, 'messages', messagesRequiredCols)

  if (sessionsMissing === null && messagesMissing === null) return // 全新 DB
  if (sessionsMissing?.length === 0 && messagesMissing?.length === 0) return // 都最新

  const reasons: string[] = []
  if (sessionsMissing && sessionsMissing.length > 0)
    reasons.push(`sessions(missing: ${sessionsMissing.join(', ')})`)
  if (messagesMissing && messagesMissing.length > 0)
    reasons.push(`messages(missing: ${messagesMissing.join(', ')})`)

  log.info(
    `[ChatDB] schema outdated [${reasons.join('; ')}]. ` +
      `Dropping sessions + messages and recreating with fresh schema (old data discarded).`,
  )
  db.exec('DROP TABLE IF EXISTS messages;')
  db.exec('DROP TABLE IF EXISTS sessions;')
}

/** 返回缺失列名数组；表不存在返 null（区分"表不存在"vs"表存在但缺列"）。 */
function collectMissingCols(
  db: Database.Database,
  tableName: string,
  required: string[],
): string[] | null {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName) as { name: string } | undefined
  if (!exists) return null
  const cols = (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
  return required.filter((c) => !cols.includes(c))
}

/**
 * Subagent delegation TASK-1：启动期把所有 status='running' 且
 * parent_session_id 非空的 session 转成 'aborted'。
 *
 * 用途：上次进程崩溃留下的 in-flight 子 session，在新一次启动时纠正状态，
 * 避免 UI 永远显示"跑中"。
 *
 * 仅作用于子 session（parent_session_id IS NOT NULL）；顶层 session 的
 * 'running' 状态目前未被本特性使用，保留不动。
 */
export function cleanupOrphanRunningSubSessions(db: Database.Database): void {
  const info = db
    .prepare(
      `UPDATE sessions
          SET status = 'aborted',
              updated_at = ?
        WHERE status = 'running'
          AND parent_session_id IS NOT NULL`,
    )
    .run(new Date().toISOString())
  if (info.changes > 0) {
    log.info(`[ChatDB] Cleaned up ${info.changes} orphan running sub-sessions`)
  }
}

export function closeChatDb(): void {
  if (db) {
    db.close()
    db = null
    log.info('[ChatDB] Closed')
  }
}
