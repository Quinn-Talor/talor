import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

const CREATE_SESSION_SUMMARIES = `
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id     TEXT NOT NULL PRIMARY KEY,
  summary_text   TEXT NOT NULL,
  covered_until  TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
`

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(CREATE_SESSION_SUMMARIES)
  return db
}

describe('session_summaries table', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => { db = createTestDb() })
  afterEach(() => { db.close() })

  it('inserts and retrieves a summary', () => {
    db.prepare(
      `INSERT INTO session_summaries (session_id, summary_text, covered_until, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('s1', '摘要内容', 'msg-uuid-50', 10, '2026-04-25T00:00:00.000Z')

    const row = db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get('s1') as {
      session_id: string; summary_text: string; covered_until: string; token_estimate: number
    }
    expect(row.summary_text).toBe('摘要内容')
    expect(row.covered_until).toBe('msg-uuid-50')
    expect(row.token_estimate).toBe(10)
  })

  it('INSERT OR REPLACE overwrites existing row', () => {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO session_summaries (session_id, summary_text, covered_until, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    stmt.run('s1', '旧摘要', 'msg-50', 5, '2026-04-25T00:00:00.000Z')
    stmt.run('s1', '新摘要', 'msg-55', 8, '2026-04-25T01:00:00.000Z')

    const row = db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get('s1') as {
      summary_text: string; covered_until: string
    }
    expect(row.summary_text).toBe('新摘要')
    expect(row.covered_until).toBe('msg-55')
  })
})
