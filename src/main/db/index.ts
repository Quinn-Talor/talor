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

    db.exec(CREATE_SESSIONS)
    db.exec(CREATE_MCP_SERVERS)
    db.exec(CREATE_SESSION_SUMMARIES)

    // Migrate sessions: add workspace column if missing
    const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    if (!sessionCols.some(c => c.name === 'workspace')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN workspace TEXT;`)
      log.info('[ChatDB] Migrated: added workspace column')
    }

    // Clear-and-recreate messages table when schema is outdated
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>
    const hasContentType = msgCols.some(c => c.name === 'content_type')
    const hasToolRole = msgCols.length > 0 // table exists
    if (!hasContentType && hasToolRole) {
      // Old schema without content_type — drop and recreate (clear-and-recreate migration)
      log.info('[ChatDB] Migrating messages table: dropping old schema')
      db.exec('DROP TABLE IF EXISTS messages;')
    }
    db.exec(CREATE_MESSAGES)
    db.exec(CREATE_INDEX)

  log.info('[ChatDB] Initialized at:', dbPath, 'WAL mode enabled')
  return db
}

export function closeChatDb(): void {
  if (db) {
    db.close()
    db = null
    log.info('[ChatDB] Closed')
  }
}
