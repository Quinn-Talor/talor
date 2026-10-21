import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('electron-store', () => ({ default: class {} }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { backupIfCorrupted } from './config-store'

describe('backupIfCorrupted', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('moves an invalid JSON config aside so the store can start from defaults', () => {
    const p = join(dir, 'config.json')
    writeFileSync(p, '{ "providers": { , }')
    expect(backupIfCorrupted(p)).toBe(true)
    expect(existsSync(p)).toBe(false)
    expect(readFileSync(p + '.bak', 'utf-8')).toBe('{ "providers": { , }')
  })

  it('leaves a valid config (and a missing one) alone', () => {
    const p = join(dir, 'config.json')
    expect(backupIfCorrupted(p)).toBe(false)
    writeFileSync(p, '{"config":{}}')
    expect(backupIfCorrupted(p)).toBe(false)
    expect(existsSync(p)).toBe(true)
  })
})
