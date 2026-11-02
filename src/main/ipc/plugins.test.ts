// 插件 IPC：列出、启用停用、重载（B1 AC-008）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { home, config, mockHandle } = vi.hoisted(() => ({
  home: { dir: '' },
  config: { values: {} as Record<string, unknown> },
  mockHandle: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({
  app: { getPath: () => home.dir },
  ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) },
}))
vi.mock('../store/config-store', () => ({
  ConfigStore: {
    getInstance: () => ({
      get: (key: string) => config.values[key],
      set: (key: string, value: unknown) => {
        config.values[key] = value
      },
    }),
  },
}))

import type { PluginInfo } from '@shared/types/ipc'
import { registerPluginHandlers } from './plugins'

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function handler(channel: string) {
  return mockHandle.mock.calls.find((c) => c[0] === channel)![1] as (
    ...a: unknown[]
  ) => Promise<PluginInfo[]>
}

let root: string

beforeEach(() => {
  home.dir = mkdtempSync(join(tmpdir(), 'talor-plugin-ipc-'))
  root = join(home.dir, '.talor', 'plugins')
  write(join(root, 'p1', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'alpha' }))
  write(
    join(root, 'p1', 'skills', 'review', 'SKILL.md'),
    '---\nname: review\ndescription: r\n---\nR\n',
  )
  write(join(root, 'p1', 'commands', 'go.md'), 'Go\n')
  write(join(root, 'p2', 'skills', 'ok', 'SKILL.md'), '---\nname: ok\ndescription: ok\n---\nOK\n')
  write(join(root, 'p3', 'skills', 'bad', 'SKILL.md'), '---\nname: bad\n---\nbad\n')
  config.values = { plugins: { enabled: ['alpha', 'p3'] } }
  mockHandle.mockClear()
  registerPluginHandlers()
})

afterEach(() => {
  rmSync(home.dir, { recursive: true, force: true })
})

describe('plugin IPC', () => {
  it('B1 AC-008 lists, enables, disables and reloads plugins', async () => {
    let list = await handler('plugins:reload')(null)
    expect(list.map((p) => [p.name, p.enabled, p.loaded, p.error !== undefined])).toEqual([
      ['alpha', true, true, false],
      ['p2', false, false, false],
      ['p3', true, false, true],
    ])
    expect(list[0]!.counts).toEqual({ skills: 1, agents: 0, mcpServers: 0, hooks: 0, commands: 1 })
    expect(list[0]!.dir).toBe(join(root, 'p1'))
    expect(await handler('plugins:list')(null)).toEqual(list)

    list = await handler('plugins:set-enabled')(null, 'p2', true)
    expect(config.values.plugins).toEqual({ enabled: ['alpha', 'p3', 'p2'] })
    expect(list.find((p) => p.name === 'p2')).toMatchObject({ enabled: true, loaded: true })
    await handler('plugins:set-enabled')(null, 'p2', true)
    expect(config.values.plugins).toEqual({ enabled: ['alpha', 'p3', 'p2'] })

    list = await handler('plugins:set-enabled')(null, 'alpha', false)
    expect(config.values.plugins).toEqual({ enabled: ['p3', 'p2'] })
    expect(list.find((p) => p.name === 'alpha')).toMatchObject({ enabled: false, loaded: false })
  })
})
