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

/**
 * Turn trace 四表 — 字段对齐 Langfuse 对象模型(Trace / Observation / Score)。
 *
 *   traces        一轮对话一行,id = 该轮 messageId
 *   observations  trace 内每个工作单元(AGENT / CHAIN / GENERATION / TOOL / GUARDRAIL ...)
 *   scores        事后评价(用户反馈、评估结果)
 *   trace_blobs   GENERATION 输入消息按 sha256 在 trace 内去重存放
 *
 * 不加 CHECK 枚举:observation type 会随 Langfuse 扩展,CHECK 无法 ALTER 只能 DROP 重建;
 * 枚举校验在共享类型与 IPC zod schema 中完成。
 * 删除联动:session 删除 → traces 级联 → observations / scores / trace_blobs 级联。
 */
const CREATE_TRACE_TABLES = `
CREATE TABLE IF NOT EXISTS traces (
    id          TEXT PRIMARY KEY,
    timestamp   TEXT NOT NULL,
    name        TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    user_id     TEXT,
    release     TEXT,
    version     TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    metadata    TEXT NOT NULL DEFAULT '{}',
    input       TEXT,
    output      TEXT,
    environment TEXT NOT NULL,
    end_time    TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id, timestamp);

CREATE TABLE IF NOT EXISTS observations (
    id                    TEXT PRIMARY KEY,
    trace_id              TEXT NOT NULL,
    parent_observation_id TEXT,
    type                  TEXT NOT NULL,
    name                  TEXT NOT NULL,
    start_time            TEXT NOT NULL,
    end_time              TEXT,
    completion_start_time TEXT,
    level                 TEXT NOT NULL DEFAULT 'DEFAULT',
    status_message        TEXT,
    provided_model_name   TEXT,
    model_parameters      TEXT,
    input                 TEXT,
    output                TEXT,
    metadata              TEXT NOT NULL DEFAULT '{}',
    usage_details         TEXT,
    cost_details          TEXT,
    prompt_name           TEXT,
    prompt_version        INTEGER,
    version               TEXT,
    environment           TEXT NOT NULL,
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_observations_trace ON observations(trace_id, start_time);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type, name);

CREATE TABLE IF NOT EXISTS scores (
    id             TEXT PRIMARY KEY,
    trace_id       TEXT,
    observation_id TEXT,
    session_id     TEXT,
    name           TEXT NOT NULL,
    value          REAL NOT NULL DEFAULT 0,
    string_value   TEXT,
    data_type      TEXT NOT NULL,
    source         TEXT NOT NULL,
    comment        TEXT,
    timestamp      TEXT NOT NULL,
    environment    TEXT NOT NULL,
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scores_trace ON scores(trace_id);

CREATE TABLE IF NOT EXISTS trace_blobs (
    trace_id TEXT NOT NULL,
    hash     TEXT NOT NULL,
    bytes    INTEGER NOT NULL,
    content  TEXT NOT NULL,
    PRIMARY KEY (trace_id, hash),
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);
`

const DAY_MS = 86_400_000

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('ChatDB not initialized. Call initChatDb() first.')
  }
  return db
}

export function initChatDb(): Database.Database {
  if (db) return db

  // TALOR_HOME 覆盖(仅供 E2E 隔离,不碰真 ~/.talor;未设则用真实 home)。
  const home = process.env.TALOR_HOME ?? app.getPath('home')
  const dir = join(home, '.talor')
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
  ensureSessionUsageColumns(db)
  db.exec(CREATE_MESSAGES)
  db.exec(CREATE_INDEX)
  ensureMessagesTraceColumn(db)
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
  // trace 表失败只降级观测,不阻断启动(观测 fail-open)。
  try {
    initTraceTables(db)
  } catch (err) {
    log.warn('[ChatDB] trace tables init failed:', err)
  }

  // Cleanup orphan running sub-sessions left from previous crashed runs.
  cleanupOrphanRunningSubSessions(db)
  try {
    sweepOpenTraces(db, new Date().toISOString())
  } catch (err) {
    log.warn('[ChatDB] trace sweep failed:', err)
  }

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
    'reasoning',
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

/** 建 trace 四表与索引(幂等)。只关乎观测:initChatDb 中失败只记 warn(fail-open)。 */
export function initTraceTables(db: Database.Database): void {
  db.exec(CREATE_TRACE_TABLES)
}

/**
 * 给 messages 补 trace_id 列与索引(幂等)。
 *
 * messageRepo 每次写消息都带这一列,属于必需迁移:initChatDb 中不包 try(失败即启动失败,
 * 同 ensureSessionUsageColumns),不能随 trace 四表一起 fail-open,否则消息写入全部失败。
 * 走"先查 PRAGMA 再 ALTER",不进 recreateSessionsIfOutdated 的必需列清单 —— 缺这一列
 * 只说明来自旧版本,不应触发整表 DROP。
 */
export function ensureMessagesTraceColumn(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
  if (!cols.includes('trace_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN trace_id TEXT')
    log.info('[ChatDB] added messages.trace_id')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_trace ON messages(trace_id);')
}

/**
 * 启动期收尾:上次进程未正常结束留下的 open trace / observation(end_time IS NULL)
 * 统一以 nowIso 结束,observation 标 ERROR + ABORTED_BY_RESTART,
 * trace 的 metadata.exit_reason 记为 'aborted_by_restart'。
 */
export function sweepOpenTraces(db: Database.Database, nowIso: string): void {
  const sweep = db.transaction(() => {
    const obs = db
      .prepare(
        `UPDATE observations
            SET end_time = ?, level = 'ERROR', status_message = 'ABORTED_BY_RESTART'
          WHERE end_time IS NULL`,
      )
      .run(nowIso)
    const traces = db
      .prepare(
        `UPDATE traces
            SET end_time = ?, updated_at = ?,
                metadata = json_set(metadata, '$.exit_reason', 'aborted_by_restart')
          WHERE end_time IS NULL`,
      )
      .run(nowIso, nowIso)
    return { traces: traces.changes, observations: obs.changes }
  })
  const n = sweep()
  if (n.traces > 0 || n.observations > 0) {
    log.info(`[ChatDB] Swept ${n.traces} open traces, ${n.observations} open observations`)
  }
}

/**
 * 删除 timestamp 早于 (nowIso - retentionDays 天) 的 trace;observations / scores /
 * trace_blobs 由外键级联删除(依赖 initChatDb 的 foreign_keys = ON)。
 * retentionDays <= 0 表示不清理。返回删除的 trace 数。
 */
export function pruneTraces(db: Database.Database, retentionDays: number, nowIso: string): number {
  if (retentionDays <= 0) return 0
  const cutoff = new Date(Date.parse(nowIso) - retentionDays * DAY_MS).toISOString()
  const info = db.prepare('DELETE FROM traces WHERE timestamp < ?').run(cutoff)
  if (info.changes > 0) {
    log.info(`[ChatDB] Pruned ${info.changes} traces older than ${retentionDays} days`)
  }
  return info.changes
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
