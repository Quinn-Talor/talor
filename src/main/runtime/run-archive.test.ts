import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { sqliteArchive } from '@talor/agent-engine/adapters/sqlite'
import { INTERACTIVE_ENVIRONMENT, openRunArchive } from './run-archive'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'talor-run-archive-'))
  file = join(dir, 'runs.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const versionOf = (path: string) => {
  const db = new Database(path, { readonly: true })
  try {
    return (
      db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }
    ).value
  } finally {
    db.close()
  }
}

describe('openRunArchive', () => {
  it('AC-001 moves an archive with another schema version aside and opens a new one', async () => {
    const current = sqliteArchive({ file })
    current.close()
    const engineVersion = versionOf(file)
    const db = new Database(file)
    db.prepare("UPDATE meta SET value = '2' WHERE key = 'schema_version'").run()
    db.close()
    writeFileSync(`${file}-wal`, '')

    const archive = openRunArchive(file)

    const backups = readdirSync(dir).filter((f) => f.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^runs\.db\.v2-\d{14}\.bak$/)
    expect(existsSync(join(dir, `${backups[0]}-wal`))).toBe(true)
    expect(versionOf(join(dir, backups[0]))).toBe('2')
    expect(versionOf(file)).toBe(engineVersion)
    expect(await archive.query({})).toEqual([])
  })

  it('AC-001 adds a counter when a backup with the same name exists', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 3, 9, 8, 7))
    try {
      let calls = 0
      const open = ((opts: { file: string }) => {
        if (calls++ === 0) throw new Error('archive: 档案文件的表结构版本 2 与本版本的 3 不一致')
        return sqliteArchive({ file: opts.file })
      }) as typeof sqliteArchive
      writeFileSync(file, '')
      writeFileSync(join(dir, 'runs.db.vunknown-20261103090807.bak'), 'earlier')

      openRunArchive(file, open)

      expect(
        readdirSync(dir)
          .filter((f) => f.endsWith('.bak'))
          .sort(),
      ).toEqual(['runs.db.vunknown-20261103090807-1.bak', 'runs.db.vunknown-20261103090807.bak'])
      expect(calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC-002 creates a new archive when the file does not exist, without backups', () => {
    openRunArchive(file)
    expect(existsSync(file)).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toEqual([])
  })

  it('AC-003 rethrows other errors and leaves the file in place', () => {
    writeFileSync(file, 'not a sqlite database')
    expect(() => openRunArchive(file)).toThrow()
    expect(existsSync(file)).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toEqual([])
  })

  it('keeps the runs of user sessions until the session is deleted, others for 30 days', () => {
    let given: Parameters<typeof sqliteArchive>[0] | undefined
    const open = ((opts: Parameters<typeof sqliteArchive>[0]) => {
      given = opts
      return sqliteArchive(opts)
    }) as typeof sqliteArchive
    openRunArchive(file, open)
    expect(given?.retention).toEqual({
      defaultDays: 30,
      environments: { [INTERACTIVE_ENVIRONMENT]: Number.POSITIVE_INFINITY },
    })
    expect(INTERACTIVE_ENVIRONMENT).toBe('interactive')
  })
})
