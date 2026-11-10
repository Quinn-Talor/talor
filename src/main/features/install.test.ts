import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: { list: () => [] } }))

import { AgentManager } from '../agent/agent-manager'
import {
  catalogSnapshot,
  createCatalogRegistry,
  featureSourcePort,
  talorCatalogSources,
} from '../runtime/catalog'
import { SkillRegistry } from '../skills/registry'
import type { ToolDefinition } from '../tools/types'
import { installFeatures } from './install'
import type {
  FeatureAgent,
  FeatureArtifact,
  FeatureInitCtx,
  FeaturePorts,
  TalorFeatureMain,
} from './types'
import type { AgentProfile } from '../../shared/types/agent'

const ctx = {} as FeatureInitCtx
const profile = (id: string): AgentProfile =>
  ({ id, name: id, description: 'd', agentPrompt: 'p' }) as AgentProfile

function ports(over: Partial<FeaturePorts> = {}): FeaturePorts {
  return {
    registerAgent: vi.fn(),
    registerArtifactReader: vi.fn(),
    isMcpConfigured: vi.fn(() => true),
    registerCatalogSource: vi.fn(),
    ...over,
  }
}
function feature(id: string, over: Partial<TalorFeatureMain> = {}): TalorFeatureMain {
  return { id, init: vi.fn(), ...over }
}

describe('installFeatures (平台拥有注册)', () => {
  it('逐个调 init + registerIpc', () => {
    const f1 = feature('a', { registerIpc: vi.fn() })
    const f2 = feature('b') // 无 registerIpc → 不调
    installFeatures([f1, f2], ctx, ports())
    expect(f1.init).toHaveBeenCalledWith(ctx)
    expect(f1.registerIpc).toHaveBeenCalledOnce()
    expect(f2.init).toHaveBeenCalledWith(ctx)
  })

  it('agents() 逐个经 ports.registerAgent 注册', () => {
    const p = ports()
    const a1: FeatureAgent = { profile: profile('x') }
    const a2: FeatureAgent = { profile: profile('y') }
    installFeatures([feature('f', { agents: () => [a1, a2] })], ctx, p)
    expect(p.registerAgent).toHaveBeenCalledTimes(2)
    expect(p.registerAgent).toHaveBeenCalledWith(a1)
    expect(p.registerAgent).toHaveBeenCalledWith(a2)
  })

  it('artifacts() 逐个经 ports.registerArtifactReader 注册', () => {
    const p = ports()
    const art: FeatureArtifact = { type: 'stock_card', read: () => null }
    installFeatures([feature('f', { artifacts: () => [art] })], ctx, p)
    expect(p.registerArtifactReader).toHaveBeenCalledWith(art)
  })

  it('mcpDeps 未配置 → 经 isMcpConfigured 校验(查到缺失)', () => {
    const isMcpConfigured = vi.fn(() => false)
    installFeatures(
      [feature('f', { mcpDeps: () => [{ name: 'Playwright', hint: 'h' }] })],
      ctx,
      ports({ isMcpConfigured }),
    )
    expect(isMcpConfigured).toHaveBeenCalledWith('Playwright')
  })

  it('注册顺序: init → agents → artifacts → registerIpc', () => {
    const order: string[] = []
    const f = feature('x', {
      init: vi.fn(() => order.push('init')),
      agents: vi.fn(() => {
        order.push('agents')
        return []
      }),
      artifacts: vi.fn(() => {
        order.push('artifacts')
        return []
      }),
      registerIpc: vi.fn(() => order.push('ipc')),
    })
    installFeatures([f], ctx, ports())
    expect(order).toEqual(['init', 'agents', 'artifacts', 'ipc'])
  })

  it('单个 feature 装配抛错 → 跳过它,其余照常装配', () => {
    const bad = feature('bad', {
      init: vi.fn(() => {
        throw new Error('boom')
      }),
    })
    const good = feature('good', { registerIpc: vi.fn() })
    expect(() => installFeatures([bad, good], ctx, ports())).not.toThrow()
    expect(good.registerIpc).toHaveBeenCalledOnce()
  })

  it('空列表 / 缺省方法 → 不抛', () => {
    expect(() => installFeatures([], ctx, ports())).not.toThrow()
    expect(() => installFeatures([feature('x')], ctx, ports())).not.toThrow()
  })
})

describe('Feature 经端口登记目录来源 (B1)', () => {
  const quote: ToolDefinition = {
    name: 'quote',
    description: 'q',
    parameters: { type: 'object' },
    execute: async () => ({ output: 'q' }),
  }

  it('B1 AC-003 registers feature:<id>, and a user agent with the same id takes over', () => {
    const m = new AgentManager()
    m.init({ skillRegistry: SkillRegistry.fromDir(null) })
    const registry = createCatalogRegistry()
    registry.register('talor', talorCatalogSources(m))
    const register = vi.fn(featureSourcePort(registry, m))
    installFeatures(
      [feature('f1', { agents: () => [{ profile: profile('inv'), tools: [quote] }] })],
      ctx,
      {
        registerAgent: (fa) => m.registerFeatureAgent(fa.profile),
        registerArtifactReader: vi.fn(),
        isMcpConfigured: () => true,
        registerCatalogSource: register,
      },
    )
    const agents = () =>
      catalogSnapshot(registry.sources()).agents.map((a) => [
        a.profile.id,
        a.profile.name,
        a.featureTools.map((t) => t.name),
      ])

    expect(register).toHaveBeenCalledWith('feature:f1', expect.any(Object))
    expect(m.featureAgentIds().has('inv')).toBe(true)
    expect(
      talorCatalogSources(m)
        .agents()
        .map((a) => a.profile.id),
    ).not.toContain('inv')
    expect(agents()).toEqual([['inv', 'inv', ['quote']]])

    // agents:create-from-draft 以同 id 注册用户版
    m.registerBusinessAgent('inv', { profile: { ...profile('inv'), name: 'user' }, source: null })
    expect(m.featureAgentIds().has('inv')).toBe(false)
    expect(agents()).toEqual([['inv', 'user', []]])

    m.unregisterBusinessAgent('inv')
    expect(agents()).toEqual([])
  })

  it('B1 does not register a feature whose assembly throws', () => {
    const register = vi.fn()
    installFeatures(
      [
        feature('bad', {
          init: () => {
            throw new Error('boom')
          },
          agents: () => [{ profile: profile('x') }],
        }),
      ],
      ctx,
      ports({ registerCatalogSource: register }),
    )
    expect(register).not.toHaveBeenCalled()
  })
})
