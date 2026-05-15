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

/**
 * side_effect_log — 副作用审计 (写 DB / 写文件 / 调外部 API 等)。
 * 供 forced summary 内嵌摘要 + UI 审计 + 用户回滚参考。
 *
 * 设计要点:
 *   - parent_session_id: 子 session 副作用归属父 (root_session) 聚合查询
 *   - confirmed_by (v4):
 *       'fallback'     — 代码 regex 兜底拦截危险关键字,用户 confirm
 *       'memory'       — SessionApprovalMemory pattern 自动通过
 *       'high-static'  — HIGH 静态工具 (bash/write/edit),系统生成 summary,用户 confirm
 *       'auto-low'     — 无风险信号,直接执行(理论上不进 ledger,保留枚举兜底)
 *   - user_decision: 'approved' / 'denied' / 'auto'
 *
 * 删除联动: session 删除时 FOREIGN KEY CASCADE 自动清理 entry。
 */
const CREATE_SIDE_EFFECT_LOG = `
CREATE TABLE IF NOT EXISTS side_effect_log (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  parent_session_id   TEXT,
  message_id          TEXT NOT NULL,
  tool_call_id        TEXT NOT NULL,
  step_index          INTEGER NOT NULL,
  op                  TEXT NOT NULL,
  target              TEXT NOT NULL,
  preview             TEXT NOT NULL,
  confirmed_by        TEXT NOT NULL CHECK(confirmed_by IN ('fallback','memory','auto-low','high-static')),
  user_decision       TEXT NOT NULL CHECK(user_decision IN ('approved','denied','auto')),
  created_at          TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

const CREATE_SIDE_EFFECT_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_side_effect_session ON side_effect_log(session_id);
CREATE INDEX IF NOT EXISTS idx_side_effect_parent ON side_effect_log(parent_session_id);
`

/**
 * reflection_ledger — Reflector 决策审计。
 * Reflector 每次产出 hint / wrapUp / internalNudge / userOutput 时落一行, 供 UI debug
 * "系统如何引导 LLM" 与 reflect 数据驱动调优。
 */
const CREATE_REFLECTION_LEDGER = `
CREATE TABLE IF NOT EXISTS reflection_ledger (
  id                       TEXT PRIMARY KEY,
  session_id               TEXT NOT NULL,
  step_index               INTEGER NOT NULL,
  reflector                TEXT NOT NULL,
  output_kind              TEXT NOT NULL CHECK(output_kind IN ('hint','wrap_up','internal_nudge','user_output')),
  judge_complete           INTEGER,
  judge_pending_items      TEXT,
  correction_mask_count    INTEGER,
  direct_output_text       TEXT,
  direct_output_label      TEXT,
  confidence               REAL NOT NULL,
  reason                   TEXT,
  created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

const CREATE_REFLECTION_LEDGER_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_reflection_session ON reflection_ledger(session_id, step_index);
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
  // v3.7.2: CHECK 约束 schema 变化时直接 DROP + 重建。
  // SQLite 不支持 ALTER TABLE 改 CHECK,只能 drop;按项目策略 (不保留历史数据)。
  recreateSideEffectLogIfOutdated(db)
  recreateReflectionLedgerIfOutdated(db)

  db.exec(CREATE_SIDE_EFFECT_LOG)
  db.exec(CREATE_SIDE_EFFECT_INDEXES)
  db.exec(CREATE_REFLECTION_LEDGER)
  db.exec(CREATE_REFLECTION_LEDGER_INDEXES)

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

/**
 * side_effect_log CHECK 约束 schema-drift 检测 + DROP 重建。
 *
 * SQLite 的 CHECK 约束无法 ALTER,且我们不保留 ledger 历史(开发期数据可丢)。
 * 启动时读 sqlite_master.sql 拿当前表定义,若 CHECK 列表与 v4 canonical 不一致 → DROP 重建。
 *
 * v4 canonical 枚举:fallback / memory / auto-low / high-static (移除 'pendingBlock')。
 */
function recreateSideEffectLogIfOutdated(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='side_effect_log'")
    .get() as { sql?: string } | undefined
  if (!row || !row.sql) return // 全新 DB,后续 CREATE 走默认路径
  // v4: 必须含 high-static + 不含 pendingBlock
  const hasHighStatic = row.sql.includes("'high-static'")
  const hasPendingBlock = row.sql.includes("'pendingBlock'")
  if (hasHighStatic && !hasPendingBlock) return // schema 已是 v4 canonical
  log.info(
    '[ChatDB] side_effect_log CHECK constraint outdated (v4 schema migration). ' +
      'Dropping and recreating (old ledger entries discarded).',
  )
  db.exec('DROP TABLE IF EXISTS side_effect_log;')
}

/**
 * reflection_ledger CHECK 约束 schema-drift 检测 + DROP 重建。
 *
 * v5 canonical 枚举: hint / wrap_up / internal_nudge / user_output
 * (替换旧 direct_output_end / direct_output_continue, 反映 reflect outcome
 * 接口的"内部引导 vs 用户回复"语义分离)。
 *
 * 启动时若表定义仍含旧 direct_output_* 枚举 → DROP 重建 (ledger 历史可丢)。
 */
function recreateReflectionLedgerIfOutdated(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reflection_ledger'")
    .get() as { sql?: string } | undefined
  if (!row || !row.sql) return // 全新 DB
  const hasOldKinds =
    row.sql.includes("'direct_output_end'") || row.sql.includes("'direct_output_continue'")
  const hasNewKinds = row.sql.includes("'internal_nudge'") && row.sql.includes("'user_output'")
  if (!hasOldKinds && hasNewKinds) return // 已 v5 canonical
  log.info(
    '[ChatDB] reflection_ledger CHECK constraint outdated (v5 schema migration). ' +
      'Dropping and recreating (old reflect entries discarded).',
  )
  db.exec('DROP TABLE IF EXISTS reflection_ledger;')
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
