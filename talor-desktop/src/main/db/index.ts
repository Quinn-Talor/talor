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
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

const CREATE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
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
    db.exec(CREATE_MESSAGES)
    db.exec(CREATE_INDEX)

    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    if (!cols.some(c => c.name === 'workspace')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN workspace TEXT;`)
      log.info('[ChatDB] Migrated: added workspace column')
    }

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
