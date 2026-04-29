import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

// 用临时目录作为 app.getPath('home') 的返回值——实打实读写磁盘，贴近真实行为。
let fakeHome: string

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return fakeHome
      throw new Error(`unexpected getPath arg: ${name}`)
    }),
  },
}))

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { PermissionStore } from './permission-store'

const WS = '/Users/alice/projects/foo'

function workspaceFile(home: string, workspacePath: string): string {
  const hash = createHash('sha1').update(workspacePath).digest('hex').slice(0, 16)
  return join(home, '.talor', 'workspaces', hash, 'permissions.json')
}

describe('PermissionStore', () => {
  let store: PermissionStore

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'talor-perm-test-'))
    store = new PermissionStore()
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
  })

  describe('session rules', () => {
    it('addSessionRule returns rule with generated id/createdAt and scope=session', () => {
      const rule = store.addSessionRule(WS, {
        tool: 'read',
        argPattern: '/Users/alice/Desktop/',
        effect: 'allow',
      })
      expect(rule.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(rule.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(rule.scope).toBe('session')
      expect(rule.tool).toBe('read')
    })

    it('session rules do not persist to disk', () => {
      store.addSessionRule(WS, { tool: 'bash', argPattern: '^git log.*$', effect: 'allow' })
      expect(existsSync(workspaceFile(fakeHome, WS))).toBe(false)
    })

    it('listAll returns session rules separated from persisted', () => {
      store.addSessionRule(WS, { tool: 'read', argPattern: '/a/', effect: 'allow' })
      store.addPersistedRule(WS, { tool: 'ls', argPattern: '/b/', effect: 'allow' })

      const view = store.listAll(WS)
      expect(view.session).toHaveLength(1)
      expect(view.persisted).toHaveLength(1)
      expect(view.session[0].tool).toBe('read')
      expect(view.persisted[0].tool).toBe('ls')
    })

    it('clearSession removes only session rules for a workspace', () => {
      store.addSessionRule(WS, { tool: 'read', argPattern: '/a/', effect: 'allow' })
      store.addPersistedRule(WS, { tool: 'ls', argPattern: '/b/', effect: 'allow' })

      store.clearSession(WS)
      const view = store.listAll(WS)
      expect(view.session).toHaveLength(0)
      expect(view.persisted).toHaveLength(1)
    })

    it('clearAllSessions wipes session rules across all workspaces', () => {
      store.addSessionRule(WS, { tool: 'read', argPattern: '/a/', effect: 'allow' })
      store.addSessionRule('/other/ws', { tool: 'ls', argPattern: '/b/', effect: 'allow' })

      store.clearAllSessions()
      expect(store.listAll(WS).session).toHaveLength(0)
      expect(store.listAll('/other/ws').session).toHaveLength(0)
    })
  })

  describe('persisted rules', () => {
    it('addPersistedRule writes to disk atomically', () => {
      store.addPersistedRule(WS, { tool: 'bash', argPattern: '^ls( .*)?$', effect: 'allow' })

      const file = workspaceFile(fakeHome, WS)
      expect(existsSync(file)).toBe(true)
      const raw = JSON.parse(readFileSync(file, 'utf-8'))
      expect(raw.schemaVersion).toBe(1)
      expect(raw.workspacePath).toBe(WS)
      expect(raw.rules).toHaveLength(1)
      expect(raw.rules[0].tool).toBe('bash')
      expect(raw.rules[0].scope).toBe('persisted')
    })

    it('loadPersisted returns empty list when file absent', () => {
      expect(store.loadPersisted(WS)).toEqual([])
    })

    it('loadPersisted caches result (second call does not re-read disk)', () => {
      store.addPersistedRule(WS, { tool: 'read', argPattern: '/a', effect: 'allow' })
      const first = store.loadPersisted(WS)
      // 手动清空文件，若未走 cache 会读到空列表
      writeFileSync(workspaceFile(fakeHome, WS), 'invalid json', 'utf-8')
      const second = store.loadPersisted(WS)
      expect(second).toEqual(first)
    })

    it('loadPersisted returns empty when file is corrupted (does not throw)', () => {
      const newStore = new PermissionStore()   // 全新实例，无缓存
      const file = workspaceFile(fakeHome, WS)
      mkdirSync(join(fakeHome, '.talor', 'workspaces', createHash('sha1').update(WS).digest('hex').slice(0, 16)), { recursive: true })
      writeFileSync(file, '{ this is not valid JSON', 'utf-8')
      expect(newStore.loadPersisted(WS)).toEqual([])
    })

    it('loadPersisted rejects mismatched schemaVersion', () => {
      const newStore = new PermissionStore()
      const file = workspaceFile(fakeHome, WS)
      mkdirSync(join(fakeHome, '.talor', 'workspaces', createHash('sha1').update(WS).digest('hex').slice(0, 16)), { recursive: true })
      writeFileSync(file, JSON.stringify({ schemaVersion: 99, workspacePath: WS, rules: [{ id: 'x', tool: 'read', argPattern: '/a', effect: 'allow', scope: 'persisted', createdAt: 'x' }] }), 'utf-8')
      expect(newStore.loadPersisted(WS)).toEqual([])
    })

    it('persisted rules survive across PermissionStore instances', () => {
      store.addPersistedRule(WS, { tool: 'bash', argPattern: '^npm test$', effect: 'allow' })

      const freshStore = new PermissionStore()
      const rules = freshStore.loadPersisted(WS)
      expect(rules).toHaveLength(1)
      expect(rules[0].argPattern).toBe('^npm test$')
    })

    it('different workspaces get different files (sha1 of path)', () => {
      store.addPersistedRule('/ws/a', { tool: 'read', argPattern: '/x', effect: 'allow' })
      store.addPersistedRule('/ws/b', { tool: 'read', argPattern: '/y', effect: 'allow' })

      expect(existsSync(workspaceFile(fakeHome, '/ws/a'))).toBe(true)
      expect(existsSync(workspaceFile(fakeHome, '/ws/b'))).toBe(true)
      expect(workspaceFile(fakeHome, '/ws/a')).not.toBe(workspaceFile(fakeHome, '/ws/b'))
    })
  })

  describe('removeRule', () => {
    it('removes from session layer', () => {
      const r = store.addSessionRule(WS, { tool: 'read', argPattern: '/a', effect: 'allow' })
      expect(store.removeRule(WS, r.id)).toBe(true)
      expect(store.listAll(WS).session).toHaveLength(0)
    })

    it('removes from persisted layer and updates disk', () => {
      const r = store.addPersistedRule(WS, { tool: 'read', argPattern: '/a', effect: 'allow' })
      expect(store.removeRule(WS, r.id)).toBe(true)
      const raw = JSON.parse(readFileSync(workspaceFile(fakeHome, WS), 'utf-8'))
      expect(raw.rules).toHaveLength(0)
    })

    it('returns false when id not found', () => {
      expect(store.removeRule(WS, 'nonexistent')).toBe(false)
    })
  })

  describe('allRulesFor', () => {
    it('returns session rules before persisted', () => {
      const p = store.addPersistedRule(WS, { tool: 'read', argPattern: '/p', effect: 'allow' })
      const s = store.addSessionRule(WS, { tool: 'read', argPattern: '/s', effect: 'allow' })

      const all = store.allRulesFor(WS)
      expect(all).toHaveLength(2)
      expect(all[0].id).toBe(s.id)
      expect(all[1].id).toBe(p.id)
    })

    it('returns empty for workspace with no rules', () => {
      expect(store.allRulesFor('/empty/ws')).toEqual([])
    })
  })
})
