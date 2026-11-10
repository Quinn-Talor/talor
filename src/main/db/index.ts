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
    reasoning TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0
);
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

/** 只被已删除的旧运行时写过的表；启动时删除（顺序：先删依赖别人的表）。 */
export const LEGACY_TABLES = [
  'messages',
  'session_summaries',
  'side_effect_log',
  'reflection_ledger',
  'scores',
  'observations',
  'trace_blobs',
  'traces',
] as const

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

  setupSchema(db)

  // 注：crystallizer 工作台 session 不在启动期清理。产品决策：派生 session 永久保留。
  // 即便 source S1 被用户删除，对应 workbench 仍在 DB 里（前端通过
  // agent_id !== '__crystallizer__' 过滤，用户不感知）。这避免了"事后兜底"机制，
  // 且保留了用户跟 crystallizer 的多轮对话 + workbench.metadata.created_agents。

  log.info('[ChatDB] Initialized at:', dbPath, 'WAL mode enabled')
  return db
}

/**
 * 建表与启动期修整（幂等）：先删旧表，再按需重建过时的 sessions，然后建表、补列、收尾中断的子会话。
 * 设计决策：不保留历史 session 数据（schema 是 source of truth，升级时旧数据直接丢弃）。
 */
export function setupSchema(db: Database.Database): void {
  dropLegacyTables(db)
  recreateSessionsIfOutdated(db)

  db.exec(CREATE_SESSIONS)
  ensureSessionUsageColumns(db)
  db.exec(CREATE_MCP_SERVERS)
  ensureMcpServerColumns(db)
  db.exec(CREATE_ACCOUNT_KEYS)

  // Cleanup orphan running sub-sessions left from previous crashed runs.
  cleanupOrphanRunningSubSessions(db)
}

/** 删除 LEGACY_TABLES 里实际存在的表；有删除时记一行日志。 */
export function dropLegacyTables(db: Database.Database): void {
  const existing = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string
      }>
    ).map((r) => r.name),
  )
  const dropped = LEGACY_TABLES.filter((t) => existing.has(t))
  for (const t of LEGACY_TABLES) db.exec(`DROP TABLE IF EXISTS ${t};`)
  if (dropped.length > 0) log.info('[ChatDB] dropped legacy tables', dropped)
}

/**
 * 检查 sessions 表是否符合最新 schema；必需列缺失则 DROP，让后续 `CREATE TABLE IF NOT EXISTS`
 * 重建为干净的最新 schema。必需列清单与 CREATE_SESSIONS 同步。
 * 全新数据库（表不存在）走 IF NOT EXISTS 创建路径，本函数 no-op。
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
    'reasoning',
    'created_at',
    'updated_at',
  ]
  const missing = collectMissingCols(db, 'sessions', sessionsRequiredCols)
  if (missing === null || missing.length === 0) return // 全新 DB 或已最新

  log.info(
    `[ChatDB] schema outdated [sessions(missing: ${missing.join(', ')})]. ` +
      `Dropping sessions and recreating with fresh schema (old data discarded).`,
  )
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

/**
 * 给 mcp_servers 补 env_from_account 列(幂等):MCP 服务器引用账户凭据,
 * JSON 对象 { 子进程变量名: 账户 key 名 }。
 * 缺列只说明来自旧版本,先查 PRAGMA 再 ALTER,不包 try。
 */
export function ensureMcpServerColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
  if (!cols.includes('env_from_account')) {
    db.exec('ALTER TABLE mcp_servers ADD COLUMN env_from_account TEXT')
    log.info('[ChatDB] added mcp_servers.env_from_account')
  }
}

/**
 * 给已存在的 sessions 表补 token 统计列(增量 ALTER, 不丢历史)。
 * 列已存在时 SQLite 报 "duplicate column", 捕获忽略 → 幂等。
 * 注: 这几列不进 recreateSessionsIfOutdated 的必需列清单, 避免触发 drop。
 */
function ensureSessionUsageColumns(db: Database.Database): void {
  const cols = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
  for (const c of cols) {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`)
      log.info(`[ChatDB] added sessions.${c}`)
    } catch {
      // 列已存在, 忽略
    }
  }
}

export function closeChatDb(): void {
  if (db) {
    db.close()
    db = null
    log.info('[ChatDB] Closed')
  }
}
