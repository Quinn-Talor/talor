import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))

const { mockGet, getSession } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet, getDelegation: () => ({}) }) },
}))
vi.mock('../repos/session-repo', () => ({
  sessionRepo: { getById: getSession },
  messageRepo: {},
}))
vi.mock('../chat/orchestrator', () => ({ sendChat: vi.fn() }))

import log from 'electron-log'
import type { AgentManager } from '../agent/agent-manager'
import type { ChatCallbacks, ChatPorts } from '../chat/types'
import {
  catalogRegistry,
  currentCatalog,
  type AgentCapabilities,
  type CatalogSnapshot,
} from './catalog'
import { coverageOf, dispatchTurn, ENGINE_KINDS, runtimeMode } from './dispatch'
import type { Runtime } from './engine'

const caps = (patch: Partial<Record<string, unknown[]>> = {}): AgentCapabilities =>
  ({
    builtins: [],
    mcpServers: [],
    skills: [],
    delegates: [],
    featureTools: [],
    missing: { mcpServers: [], skills: [], subagents: [] },
    ...patch,
  }) as unknown as AgentCapabilities

describe('runtimeMode', () => {
  beforeEach(() => mockGet.mockReset())

  it('AC-001 maps the runtime config to off, auto or force', () => {
    const values = [undefined, 'off', 'legacy', 'auto', 'force', 'engine', 'xyz']
    const modes = values.map((v) => {
      mockGet.mockReturnValueOnce(v)
      return runtimeMode()
    })
    expect(modes).toEqual(['off', 'off', 'off', 'auto', 'force', 'force', 'off'])
    expect(mockGet).toHaveBeenCalledWith('runtime')
  })
})

describe('coverageOf', () => {
  it('AC-002 lists the non-empty kinds the engine does not support', () => {
    const all = caps({
      builtins: [1],
      mcpServers: [1],
      skills: [1],
      delegates: [1],
      featureTools: [1],
    })
    expect(coverageOf(all)).toEqual({ complete: true, missing: [] })
    expect(coverageOf(caps({ builtins: [1] }))).toEqual({ complete: true, missing: [] })
    expect(coverageOf({ ...caps({ builtins: [1] }), hooks: [1] } as AgentCapabilities)).toEqual({
      complete: false,
      missing: ['hooks'],
    })
    const missingOnly = caps()
    missingOnly.missing = { mcpServers: ['x'], skills: ['y'], subagents: ['z'] }
    expect(coverageOf(missingOnly)).toEqual({ complete: true, missing: [] })
    const withoutDelegates = ENGINE_KINDS.filter((k) => k !== 'delegates')
    expect(coverageOf(caps({ delegates: [1] }), withoutDelegates)).toEqual({
      complete: false,
      missing: ['delegates'],
    })
    expect(coverageOf(caps({ hooks: [] } as never))).toEqual({ complete: true, missing: [] })
  })
})

describe('dispatchTurn', () => {
  const params = { sessionId: 's1', content: 'hi', attachments: [] }
  const callbacks = {} as ChatCallbacks
  const ports = {
    confirmTool: vi.fn(),
    agentManager: {
      getAgent: () => null,
      getChatAgent: () => ({
        profile: { id: '__chat__', name: 'T', description: '', agentPrompt: 'p' },
      }),
    } as unknown as AgentManager,
  } as ChatPorts
  const runtime = {} as Runtime

  function snapshotOf(c: AgentCapabilities): CatalogSnapshot {
    return {
      version: 'v',
      builtins: [],
      mcpServers: [],
      skills: [],
      agents: [],
      commands: [],
      select: () => c,
    }
  }

  beforeEach(() => {
    getSession.mockReturnValue({ agent_id: '__chat__' })
    vi.mocked(log.info).mockClear()
  })

  it('AC-003 picks the path by mode, coverage and runtime availability', async () => {
    const complete = snapshotOf(caps({ builtins: [1] }))
    const incomplete = snapshotOf({ ...caps({ builtins: [1] }), hooks: [1] } as AgentCapabilities)
    const legacy = vi.fn(async () => ({ messageId: 'legacy' }))
    const engine = vi.fn(async () => ({ messageId: 'engine' }))
    const run = (
      mode: 'off' | 'auto' | 'force',
      opts: { runtime?: () => Runtime; catalog?: () => CatalogSnapshot },
    ) =>
      dispatchTurn(params, callbacks, ports, {
        mode: () => mode,
        legacy,
        engine,
        runtime: opts.runtime ?? (() => runtime),
        catalog: opts.catalog ?? (() => complete),
      })

    const paths = [
      await run('off', {}),
      await run('force', {}),
      await run('auto', {}),
      await run('auto', {
        runtime: () => {
          throw new Error('no runtime')
        },
      }),
      await run('auto', { catalog: () => incomplete }),
      await run('auto', {
        catalog: () => {
          throw new Error('catalog broke')
        },
      }),
    ].map((r) => r.messageId)
    expect(paths).toEqual(['legacy', 'engine', 'engine', 'legacy', 'legacy', 'legacy'])

    // auto 走引擎时，交给引擎的目录函数返回分派时算出的同一个快照
    const autoCall = engine.mock.calls[1] as unknown as [
      unknown,
      unknown,
      unknown,
      { catalog: () => CatalogSnapshot },
    ]
    expect(autoCall[3].catalog()).toBe(complete)
    const reasons = JSON.stringify(vi.mocked(log.info).mock.calls)
    expect(reasons).toContain('no runtime')
    expect(reasons).toContain('hooks')
    expect(reasons).toContain('catalog broke')
  })

  it('B2 AC-009 sends auto turns with plugin hooks to the engine and warns under off', async () => {
    const incomplete = snapshotOf({ ...caps({ builtins: [1] }), hooks: [1] } as AgentCapabilities)
    const hook = [{ event: 'PreToolUse' as const, command: 'g' }]
    const legacy = vi.fn(async () => ({ messageId: 'legacy' }))
    const engine = vi.fn(async () => ({ messageId: 'engine' }))
    const run = (
      mode: 'off' | 'auto' | 'force',
      hooks: typeof hook,
      opts: { runtime?: () => Runtime; catalog?: () => CatalogSnapshot } = {},
    ) =>
      dispatchTurn(params, callbacks, ports, {
        mode: () => mode,
        legacy,
        engine,
        runtime: opts.runtime ?? (() => runtime),
        catalog: opts.catalog ?? (() => incomplete),
        pluginHooks: () => hooks,
      })
    vi.mocked(log.warn).mockClear()
    const paths = [
      await run('auto', hook),
      await run('auto', []),
      await run('off', hook),
      await run('off', []),
      await run('force', hook),
      await run('force', []),
      await run('auto', hook, {
        runtime: () => {
          throw new Error('no runtime')
        },
      }),
      await run('auto', hook, {
        catalog: () => {
          throw new Error('catalog broke')
        },
      }),
    ].map((r) => r.messageId)
    expect(paths).toEqual([
      'engine',
      'legacy',
      'legacy',
      'legacy',
      'engine',
      'engine',
      'engine',
      'engine',
    ])
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).toContain('runtime=off')
    const hooked = engine.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      { catalog: () => CatalogSnapshot },
    ]
    expect(hooked[3].catalog()).toBe(incomplete)
  })

  it('B1 AC-020 uses the global registry when no catalog is injected', async () => {
    const tool = (name: string) => ({
      name,
      description: name,
      parameters: { type: 'object' },
      execute: async () => ({ output: name }),
    })
    const unregister = [
      catalogRegistry.register('talor', { builtins: () => [tool('read')] }),
      catalogRegistry.register('feature:f1', {
        agents: () => [
          {
            profile: { id: 'inv', name: 'inv', description: '', agentPrompt: 'p' },
            featureTools: [tool('quote')],
          },
        ],
      }),
      catalogRegistry.register('plugins', {
        mcpEntries: () => [
          {
            id: 'plugin:alpha:gh',
            name: 'alpha:gh',
            slug: 'plugin_alpha_gh',
            spec: { name: 'plugin_alpha_gh', transport: { kind: 'stdio', command: 'gh' } },
          },
        ],
      }),
    ]
    try {
      const engine = vi.fn(async () => ({ messageId: 'engine' }))
      await dispatchTurn(params, callbacks, ports, {
        mode: () => 'auto',
        legacy: vi.fn(),
        engine,
        runtime: () => runtime,
      })
      const given = (
        engine.mock.calls[0] as unknown as [
          unknown,
          unknown,
          unknown,
          { catalog: () => CatalogSnapshot },
        ]
      )[3].catalog()
      expect(given.version).toBe(currentCatalog().version)
      expect(given.agents.map((a) => [a.profile.id, a.featureTools.map((t) => t.name)])).toEqual([
        ['inv', ['quote']],
      ])
      expect(given.mcpServers.map((e) => e.name)).toEqual(['alpha:gh'])
    } finally {
      for (const off of unregister) off()
    }
  })

  it('B1 AC-017 sends plugin commands to the engine in auto mode only', async () => {
    const withCommand = {
      ...snapshotOf({ ...caps({ builtins: [1] }), hooks: [1] } as AgentCapabilities),
      commands: [{ name: 'alpha:review', content: 'Review: $ARGUMENTS', source: 'plugin:alpha' }],
    }
    const legacy = vi.fn(async () => ({ messageId: 'legacy' }))
    const engine = vi.fn(async () => ({ messageId: 'engine' }))
    const catalog = vi.fn(() => withCommand)
    const run = async (mode: 'off' | 'auto' | 'force', content: string) =>
      (
        await dispatchTurn({ ...params, content }, callbacks, ports, {
          mode: () => mode,
          legacy,
          engine,
          runtime: () => runtime,
          catalog,
        })
      ).messageId

    expect(await run('auto', '/alpha:review a.ts')).toBe('engine')
    expect(catalog).toHaveBeenCalledTimes(1)
    const given = (
      engine.mock.calls[0] as unknown as [
        unknown,
        unknown,
        unknown,
        { catalog: () => CatalogSnapshot },
      ]
    )[3].catalog()
    expect(given).toBe(withCommand)
    expect(await run('auto', 'hello')).toBe('legacy')
    expect(await run('off', '/alpha:review a.ts')).toBe('legacy')
    expect(await run('off', 'hello')).toBe('legacy')
    expect(await run('force', '/alpha:review a.ts')).toBe('engine')
    expect(await run('force', 'hello')).toBe('engine')
  })
})
