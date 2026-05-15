import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import Database from 'better-sqlite3'
import { reflectionLedger } from './reflection-ledger'
import * as dbModule from '../db'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS reflection_ledger (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  reflector TEXT NOT NULL,
  output_kind TEXT NOT NULL,
  judge_complete INTEGER,
  judge_pending_items TEXT,
  correction_mask_count INTEGER,
  direct_output_text TEXT,
  direct_output_label TEXT,
  confidence REAL NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(SCHEMA)
  db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run('s1', 'test')
  vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
})

afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

describe('reflectionLedger.record', () => {
  it('hint outputKind 写入', () => {
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 5,
      reflector: 'periodic',
      outputKind: 'hint',
      confidence: 0.7,
      reason: 'mid-turn',
    })
    const row = db.prepare('SELECT * FROM reflection_ledger').get() as Record<string, unknown>
    expect(row.session_id).toBe('s1')
    expect(row.step_index).toBe(5)
    expect(row.reflector).toBe('periodic')
    expect(row.output_kind).toBe('hint')
    expect(row.confidence).toBe(0.7)
  })

  it('judge internalNudge 写入 含 pending items', () => {
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 3,
      reflector: 'judge-completion',
      outputKind: 'internal_nudge',
      confidence: 0.85,
      judge: {
        complete: false,
        pendingItems: ['write README', 'commit'],
      },
      reason: 'not done',
    })
    const row = db.prepare('SELECT * FROM reflection_ledger').get() as Record<string, unknown>
    expect(row.output_kind).toBe('internal_nudge')
    expect(row.judge_complete).toBe(0)
    expect(JSON.parse(row.judge_pending_items as string)).toEqual(['write README', 'commit'])
  })

  it('correction userOutput 写入 mask count', () => {
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 7,
      reflector: 'quote-correction',
      outputKind: 'user_output',
      confidence: 0.9,
      correction: { totalMask: 3 },
      direct: { text: 'rewritten', label: '[reflect-correction]' },
    })
    const row = db.prepare('SELECT * FROM reflection_ledger').get() as Record<string, unknown>
    expect(row.output_kind).toBe('user_output')
    expect(row.correction_mask_count).toBe(3)
    expect(row.direct_output_text).toBe('rewritten')
    expect(row.direct_output_label).toBe('[reflect-correction]')
  })

  it('DB 异常静默 (失败不抛)', () => {
    db.close()
    expect(() =>
      reflectionLedger.record({
        sessionId: 's1',
        stepIndex: 0,
        reflector: 'x',
        outputKind: 'hint',
        confidence: 0.5,
      }),
    ).not.toThrow()
  })
})

describe('reflectionLedger.listBySession', () => {
  it('按 step_index 升序返回', () => {
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 2,
      reflector: 'a',
      outputKind: 'hint',
      confidence: 0.5,
    })
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 0,
      reflector: 'b',
      outputKind: 'hint',
      confidence: 0.5,
    })
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 1,
      reflector: 'c',
      outputKind: 'hint',
      confidence: 0.5,
    })
    const rows = reflectionLedger.listBySession('s1')
    expect(rows.map((r) => r.step_index)).toEqual([0, 1, 2])
  })

  it('不同 session 隔离', () => {
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run('s2', 'other')
    reflectionLedger.record({
      sessionId: 's1',
      stepIndex: 0,
      reflector: 'a',
      outputKind: 'hint',
      confidence: 0.5,
    })
    reflectionLedger.record({
      sessionId: 's2',
      stepIndex: 0,
      reflector: 'b',
      outputKind: 'hint',
      confidence: 0.5,
    })
    expect(reflectionLedger.listBySession('s1')).toHaveLength(1)
    expect(reflectionLedger.listBySession('s2')).toHaveLength(1)
  })

  it('DB 异常返 []', () => {
    db.close()
    expect(reflectionLedger.listBySession('s1')).toEqual([])
  })
})
