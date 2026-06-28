import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))

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

  it('空列表 / 缺省方法 → 不抛', () => {
    expect(() => installFeatures([], ctx, ports())).not.toThrow()
    expect(() => installFeatures([feature('x')], ctx, ports())).not.toThrow()
  })
})
