// mcpServerRepo 的凭据字段：账户凭据引用 envFromAccount 的读写（修 T2）；
// auth 里 token、apiKey 的加密存储与启动迁移（修 T3）。
// 用 :memory: 数据库跑真实 SQL，表结构为迁移后的 mcp_servers。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import log from 'electron-log'

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

import { mcpServerRepo, setMcpAuthCipher, type SecretCipher } from './mcp-server-repo'

const CREATE_MCP_SERVERS = `
CREATE TABLE mcp_servers (
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
    updated_at TEXT NOT NULL,
    env_from_account TEXT
);
`

beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_MCP_SERVERS)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
  setMcpAuthCipher(undefined)
  vi.mocked(log.warn).mockClear()
  vi.mocked(log.error).mockClear()
})

/** 假的加解密对象：密文为 `enc:` 前缀。 */
function fakeCipher(overrides: Partial<SecretCipher> = {}): SecretCipher {
  return {
    isAvailable: () => true,
    encrypt: (v) => `enc:${v}`,
    decrypt: (v) => {
      if (!v.startsWith('enc:')) throw new Error('bad ciphertext')
      return v.slice(4)
    },
    ...overrides,
  }
}

function authColumn(id: string): unknown {
  const row = currentDb.instance!.prepare('SELECT auth FROM mcp_servers WHERE id = ?').get(id) as {
    auth: string | null
  }
  return row.auth === null ? null : JSON.parse(row.auth)
}

function insertRaw(id: string, auth: object | null): void {
  currentDb
    .instance!.prepare(
      `INSERT INTO mcp_servers (id, name, type, url, auth, enabled, created_at, updated_at)
       VALUES (?, ?, 'http', 'https://mcp.example.com', ?, 1, '2026-01-01', '2026-01-01')`,
    )
    .run(id, id, auth === null ? null : JSON.stringify(auth))
}

function loggedText(fn: typeof log.error): string {
  return JSON.stringify(vi.mocked(fn).mock.calls)
}

describe('envFromAccount (TASK-1)', () => {
  it('AC-002 stores, updates and reads account references', () => {
    const gh = mcpServerRepo.create({
      name: 'gh',
      type: 'stdio',
      command: 'npx',
      envFromAccount: { GH_TOKEN: 'github_pat' },
    })
    const plain = mcpServerRepo.create({ name: 'fs', type: 'stdio', command: 'npx' })

    expect(gh.envFromAccount).toEqual({ GH_TOKEN: 'github_pat' })
    expect(mcpServerRepo.getById(gh.id)?.envFromAccount).toEqual({ GH_TOKEN: 'github_pat' })
    expect(mcpServerRepo.getByName('gh')?.envFromAccount).toEqual({ GH_TOKEN: 'github_pat' })

    mcpServerRepo.update(gh.id, { envFromAccount: { GH_TOKEN: 'gh2' } })
    expect(mcpServerRepo.getById(gh.id)?.envFromAccount).toEqual({ GH_TOKEN: 'gh2' })

    const listed = new Map(mcpServerRepo.list().map((s) => [s.name, s.envFromAccount]))
    expect(listed.get('gh')).toEqual({ GH_TOKEN: 'gh2' })
    expect(listed.get('fs')).toBeUndefined()
    expect(mcpServerRepo.getById(plain.id)?.envFromAccount).toBeUndefined()
  })

  it('AC-002 imports account references through upsertFromConfig', () => {
    const created = mcpServerRepo.upsertFromConfig('gh', {
      type: 'stdio',
      command: 'npx',
      envFromAccount: { GH_TOKEN: 'github_pat' },
    })
    mcpServerRepo.upsertFromConfig('gh', {
      type: 'stdio',
      command: 'npx',
      envFromAccount: { GH_TOKEN: 'gh2' },
    })
    expect(mcpServerRepo.getById(created.id)?.envFromAccount).toEqual({ GH_TOKEN: 'gh2' })
  })
})

describe('auth encryption (TASK-2)', () => {
  it('AC-005 encrypts tokens and API keys on write and decrypts them on read', () => {
    setMcpAuthCipher(fakeCipher())
    const bearer = mcpServerRepo.create({
      name: 'b',
      type: 'http',
      url: 'https://b.example.com',
      auth: { type: 'bearer', token: 't0k' },
    })
    const apiKey = mcpServerRepo.create({
      name: 'k',
      type: 'http',
      url: 'https://k.example.com',
      auth: { type: 'apiKey', apiKey: 'k3y' },
    })

    expect(authColumn(bearer.id)).toEqual({ type: 'bearer', token: 'enc:t0k', encrypted: true })
    expect(authColumn(apiKey.id)).toEqual({ type: 'apiKey', apiKey: 'enc:k3y', encrypted: true })
    expect(mcpServerRepo.getById(bearer.id)?.auth).toEqual({ type: 'bearer', token: 't0k' })
    expect(mcpServerRepo.getByName('k')?.auth).toEqual({ type: 'apiKey', apiKey: 'k3y' })
    expect(bearer.auth).toEqual({ type: 'bearer', token: 't0k' })

    mcpServerRepo.update(bearer.id, { auth: { type: 'bearer', token: 'n3w' } })
    expect(authColumn(bearer.id)).toEqual({ type: 'bearer', token: 'enc:n3w', encrypted: true })
    expect(mcpServerRepo.list().find((s) => s.id === bearer.id)?.auth?.token).toBe('n3w')
  })

  it('AC-005 leaves an auth without secrets as it is', () => {
    setMcpAuthCipher(fakeCipher())
    const none = mcpServerRepo.create({
      name: 'n',
      type: 'http',
      url: 'https://n.example.com',
      auth: { type: 'none' },
    })
    expect(authColumn(none.id)).toEqual({ type: 'none' })
  })

  it('AC-006 stores plaintext with a warning when no cipher is set or it is unavailable', () => {
    for (const cipher of [undefined, fakeCipher({ isAvailable: () => false })]) {
      setMcpAuthCipher(cipher)
      vi.mocked(log.warn).mockClear()
      const s = mcpServerRepo.create({
        name: `p-${cipher ? 'off' : 'unset'}`,
        type: 'http',
        url: 'https://p.example.com',
        auth: { type: 'bearer', token: 't0k' },
      })
      expect(authColumn(s.id)).toEqual({ type: 'bearer', token: 't0k' })
      expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
      expect(loggedText(log.warn)).not.toContain('t0k')
      expect(mcpServerRepo.getById(s.id)?.auth).toEqual({ type: 'bearer', token: 't0k' })
    }
  })

  it('AC-007 encrypts stored plaintext credentials once', () => {
    insertRaw('plain-b', { type: 'bearer', token: 't0k' })
    insertRaw('plain-k', { type: 'apiKey', apiKey: 'k3y' })
    insertRaw('done', { type: 'bearer', token: 'enc:old', encrypted: true })
    insertRaw('none', { type: 'none' })
    insertRaw('null', null)
    setMcpAuthCipher(fakeCipher())

    expect(mcpServerRepo.encryptStoredAuth()).toBe(2)
    expect(authColumn('plain-b')).toEqual({ type: 'bearer', token: 'enc:t0k', encrypted: true })
    expect(authColumn('plain-k')).toEqual({ type: 'apiKey', apiKey: 'enc:k3y', encrypted: true })
    expect(authColumn('done')).toEqual({ type: 'bearer', token: 'enc:old', encrypted: true })
    expect(authColumn('none')).toEqual({ type: 'none' })
    expect(authColumn('null')).toBeNull()
    const updated = currentDb
      .instance!.prepare('SELECT DISTINCT updated_at FROM mcp_servers')
      .all() as Array<{ updated_at: string }>
    expect(updated).toEqual([{ updated_at: '2026-01-01' }])

    expect(mcpServerRepo.encryptStoredAuth()).toBe(0)
    expect(mcpServerRepo.getById('plain-b')?.auth).toEqual({ type: 'bearer', token: 't0k' })
  })

  it('AC-007 changes nothing when the cipher is unavailable', () => {
    insertRaw('plain-b', { type: 'bearer', token: 't0k' })
    setMcpAuthCipher(fakeCipher({ isAvailable: () => false }))
    expect(mcpServerRepo.encryptStoredAuth()).toBe(0)
    setMcpAuthCipher(undefined)
    expect(mcpServerRepo.encryptStoredAuth()).toBe(0)
    expect(authColumn('plain-b')).toEqual({ type: 'bearer', token: 't0k' })
  })

  it('AC-008 drops a credential that cannot be decrypted and keeps the server', () => {
    insertRaw('broken', { type: 'bearer', token: 'enc:t0k', encrypted: true })
    for (const cipher of [
      fakeCipher({
        decrypt: () => {
          throw new Error('keychain locked')
        },
      }),
      undefined,
    ]) {
      setMcpAuthCipher(cipher)
      vi.mocked(log.error).mockClear()
      expect(mcpServerRepo.list().map((s) => [s.id, s.auth])).toEqual([
        ['broken', { type: 'bearer' }],
      ])
      expect(mcpServerRepo.getById('broken')?.auth).toEqual({ type: 'bearer' })
      expect(vi.mocked(log.error)).toHaveBeenCalled()
      expect(loggedText(log.error)).not.toContain('enc:t0k')
    }
  })
})
