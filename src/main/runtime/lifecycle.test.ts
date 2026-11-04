// A5a：启动引擎、退出关闭、删除会话。数据库用 :memory:，引擎用桩。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))
vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: () => undefined, getDelegation: () => ({}) }) },
}))

import { getRuntime, shutdownRuntime, type Runtime } from './engine'
import { deleteEngineSession, shutdownForQuit, startEngineRuntime } from './lifecycle'

const CREATE_TABLES = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata TEXT,
  reasoning TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'blocks',
  agent_id     TEXT NOT NULL DEFAULT '__chat__',
  created_at   TEXT NOT NULL,
  trace_id     TEXT
);
`

beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_TABLES)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('startEngineRuntime', () => {
  it('AC-004 only warms up the engine', async () => {
    const calls: string[] = []
    await startEngineRuntime({ warmUp: () => void calls.push('warmUp') })
    expect(calls).toEqual(['warmUp'])
  })
})

describe('shutdownForQuit', () => {
  afterEach(async () => {
    await shutdownRuntime()
  })

  const install = (shutdown: () => Promise<void>) =>
    getRuntime({ build: () => ({ engine: { shutdown } }) as unknown as Runtime })

  it('AC-009 returns none without an engine', async () => {
    expect(await shutdownForQuit(50)).toBe('none')
  })

  it('AC-009 waits for the engine and the turns in progress', async () => {
    const order: string[] = []
    install(async () => void order.push('engine'))
    let finish!: () => void
    const turn = new Promise<void>((resolve) => (finish = resolve)).then(
      () => void order.push('turn'),
    )
    setTimeout(() => finish(), 20)
    expect(await shutdownForQuit(1000, { waitForTurns: () => turn })).toBe('closed')
    expect(order).toEqual(['engine', 'turn'])
  })

  it('AC-009 gives up after the timeout', async () => {
    install(() => new Promise<void>(() => undefined))
    const started = Date.now()
    expect(await shutdownForQuit(50)).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('deleteEngineSession', () => {
  const ok = { ok: true as const, removedRuns: 2, removedBlobs: 5 }
  const busy = { ok: false as const, code: 'session_busy' as const, message: 'busy' }

  it('deletes the session through the engine', async () => {
    const deleteSession = vi.fn(async () => ok)
    expect(await deleteEngineSession('s1', { engine: () => ({ deleteSession }) })).toBe(true)
    expect(deleteSession).toHaveBeenCalledWith('s1')
  })

  it('waits for the turn in progress once when the session is busy', async () => {
    const calls: string[] = []
    const deleteSession = vi.fn(async () => {
      calls.push('delete')
      return calls.length === 1 ? busy : ok
    })
    const waitForTurns = async () => void calls.push('wait')
    expect(
      await deleteEngineSession('s1', { engine: () => ({ deleteSession }), waitForTurns }),
    ).toBe(true)
    expect(calls).toEqual(['delete', 'wait', 'delete'])
  })

  it('gives up after the retry and when the archive still has an open run', async () => {
    const stillBusy = vi.fn(async () => busy)
    expect(
      await deleteEngineSession('s1', {
        engine: () => ({ deleteSession: stillBusy }),
        waitForTurns: async () => {},
      }),
    ).toBe(false)
    expect(stillBusy).toHaveBeenCalledTimes(2)
    const open = vi.fn(async () => ({
      ok: false as const,
      code: 'session_open' as const,
      message: 'open',
    }))
    expect(await deleteEngineSession('s1', { engine: () => ({ deleteSession: open }) })).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('deletes from the archive when the engine was never created, and never throws', async () => {
    const archive = { deleteSession: vi.fn(async () => ({ removedRuns: 1, removedBlobs: 1 })) }
    expect(
      await deleteEngineSession('s1', { engine: () => undefined, archive: () => archive }),
    ).toBe(true)
    expect(archive.deleteSession).toHaveBeenCalledWith('s1')
    const broken = {
      deleteSession: async () => {
        throw new Error('archive closed')
      },
    }
    expect(
      await deleteEngineSession('s1', { engine: () => undefined, archive: () => broken }),
    ).toBe(false)
  })
})
