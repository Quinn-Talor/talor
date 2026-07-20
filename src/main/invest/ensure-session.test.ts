// src/main/invest/ensure-session.test.ts —— ensureCardSession(修悬空 origin_session 外键)
//
// 卡的 origin_session 可能被 schema 升级 drop / 用户删会话而卡仍在(悬空引用)→ 发消息
// 会违反 messages.session_id 外键(用户实测"研究出错:FOREIGN KEY constraint failed")。
// ensureCardSession 以**同一 id** 重建该会话、绑 stock-research,使卡引用保持有效。
// 真 SQLite(:memory,卡表 + sessions 表同库:getDb mock 与 feature.init 指向同一实例)
// → 建悬空卡 → 断言重建 + 幂等 + 缺卡返 null。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))

import { investFeatureMain, ensureCardSession, getInvestStore } from './feature'
import { sessionRepo } from '../repos/session-repo'
import type { CardRepo } from './store'

// 与 db/index.ts CREATE_SESSIONS 同构(chat 会话表;ensureCardSession 往此表重建)。
const CREATE_SESSIONS = `
CREATE TABLE sessions (
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

describe('ensureCardSession(修悬空 origin_session 外键)', () => {
  let store: CardRepo

  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_SESSIONS)
    // feature.init 建卡表 + 构造模块级 investStore;getDb mock 也指向此库 → 卡与会话同库
    investFeatureMain.init({ db: currentDb.instance })
    store = getInvestStore()!
  })

  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  it('(trigger) 悬空 origin_session → 同 id 重建 + 绑 stock-research', () => {
    const c = store.apply({
      kind: 'create',
      code: '002594',
      name: '比亚迪',
      originSessionId: 'dangling-sess',
    })
    expect(sessionRepo.getById('dangling-sess')).toBeNull() // 建卡不建会话 → 悬空

    const sid = ensureCardSession(c.id, 'p1')
    expect(sid).toBe('dangling-sess') // 同 id 复用 → 卡引用保持有效
    const s = sessionRepo.getById('dangling-sess')
    expect(s?.agent_id).toBe('stock-research') // 绑研究 agent(带建卡工具,"更新卡片"可用)
    expect(s?.title).toBe('投研 · 比亚迪')
  })

  it('(idempotent) 会话已存在 → 直接返回、不覆盖重建', () => {
    const c = store.apply({
      kind: 'create',
      code: '600519',
      name: '茅台',
      originSessionId: 'live-sess',
    })
    ensureCardSession(c.id, 'p1') // 首建
    const first = sessionRepo.getById('live-sess')
    const sid = ensureCardSession(c.id, 'p1') // 再调 → 短路
    expect(sid).toBe('live-sess')
    expect(sessionRepo.getById('live-sess')?.created_at).toBe(first?.created_at) // 未被重建
  })

  it('(no-trigger) 卡不存在 → 返回 null,不建会话', () => {
    expect(ensureCardSession('no-such-card', 'p1')).toBeNull()
  })
})
