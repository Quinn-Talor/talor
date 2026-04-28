import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AccountStore } from './accounts'

let tempDir: string
let store: AccountStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'accounts-'))
  store = new AccountStore(join(tempDir, 'accounts.json'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('AccountStore', () => {
  it('AC-C2-01: list returns secret values masked', () => {
    store.save({
      service: '飞书',
      keys: [
        { name: 'feishu_appid', value: 'cli_xxx', secret: false },
        { name: 'feishu_secret', value: 's3cr3t', secret: true },
      ],
    })

    const list = store.list()
    expect(list).toHaveLength(1)

    const feishu = list[0]
    expect(feishu.service).toBe('飞书')

    const appid = feishu.keys.find(k => k.name === 'feishu_appid')!
    expect(appid.value).toBe('cli_xxx')

    const secret = feishu.keys.find(k => k.name === 'feishu_secret')!
    expect(secret.value).toBe('••••••')
  })

  it('AC-C2-02: getValue returns actual secret value', () => {
    store.save({
      service: '飞书',
      keys: [{ name: 'feishu_secret', value: 's3cr3t', secret: true }],
    })

    expect(store.getValue('feishu_secret')).toBe('s3cr3t')
  })

  it('getValue returns undefined for missing key', () => {
    expect(store.getValue('nonexistent')).toBeUndefined()
  })

  it('save updates existing service', () => {
    store.save({ service: 'A', keys: [{ name: 'k1', value: 'v1', secret: false }] })
    store.save({ service: 'A', keys: [{ name: 'k1', value: 'v2', secret: false }] })

    expect(store.list()).toHaveLength(1)
    expect(store.getValue('k1')).toBe('v2')
  })

  it('delete removes service', () => {
    store.save({ service: 'A', keys: [{ name: 'k1', value: 'v1', secret: false }] })
    store.delete('A')
    expect(store.list()).toHaveLength(0)
  })

  it('getAllValues returns all key-value pairs', () => {
    store.save({ service: 'A', keys: [{ name: 'k1', value: 'v1', secret: false }] })
    store.save({ service: 'B', keys: [{ name: 'k2', value: 'v2', secret: true }] })

    const values = store.getAllValues()
    expect(values.get('k1')).toBe('v1')
    expect(values.get('k2')).toBe('v2')
    expect(values.size).toBe(2)
  })

  it('rejects invalid key name', () => {
    expect(() => store.save({
      service: 'A',
      keys: [{ name: 'bad key!', value: 'v', secret: false }],
    })).toThrow('Invalid key name')
  })

  it('persists and reloads', () => {
    const filePath = join(tempDir, 'accounts.json')
    store.save({ service: 'A', keys: [{ name: 'k1', value: 'v1', secret: false }] })

    const store2 = new AccountStore(filePath)
    expect(store2.getValue('k1')).toBe('v1')
  })

  it('I3: SafeStorage encrypts secret values', () => {
    const encrypted = new Map<string, string>()
    const mockSafeStorage = {
      isAvailable: () => true,
      encrypt: (v: string) => { const enc = Buffer.from(v).toString('base64'); encrypted.set(v, enc); return enc },
      decrypt: (e: string) => Buffer.from(e, 'base64').toString('utf-8'),
    }

    const secureStore = new AccountStore(join(tempDir, 'secure.json'), mockSafeStorage)
    secureStore.save({
      service: 'GitHub',
      keys: [{ name: 'gh_token', value: 'ghp_secret123', secret: true }],
    })

    // 磁盘上不含明文
    const raw = require('fs').readFileSync(join(tempDir, 'secure.json'), 'utf-8')
    expect(raw).not.toContain('ghp_secret123')
    expect(raw).toContain(encrypted.get('ghp_secret123'))

    // getValue 通过 decrypt 返回原始值
    expect(secureStore.getValue('gh_token')).toBe('ghp_secret123')

    // list 返回脱敏值
    const list = secureStore.list()
    expect(list[0].keys[0].value).toBe('••••••')
  })

  it('SafeStorage not available → fallback to plaintext', () => {
    const mockSafeStorage = {
      isAvailable: () => false,
      encrypt: () => { throw new Error('not available') },
      decrypt: () => { throw new Error('not available') },
    }

    const fallbackStore = new AccountStore(join(tempDir, 'fallback.json'), mockSafeStorage)
    fallbackStore.save({
      service: 'Test',
      keys: [{ name: 'key1', value: 'plain_value', secret: true }],
    })

    expect(fallbackStore.getValue('key1')).toBe('plain_value')
  })
})
