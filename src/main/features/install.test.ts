import { describe, it, expect, vi } from 'vitest'
import { installFeatures } from './install'
import type { FeatureInitCtx, TalorFeatureMain } from './types'

const ctx = {} as FeatureInitCtx // init 不真用 db/tools,只验调用编排

function feature(id: string, over: Partial<TalorFeatureMain> = {}): TalorFeatureMain {
  return { id, init: vi.fn(), ...over }
}

describe('installFeatures', () => {
  it('逐个调 init + registerIpc', () => {
    const f1 = feature('a', { registerIpc: vi.fn() })
    const f2 = feature('b') // 无 registerIpc → 不调
    installFeatures([f1, f2], ctx)
    expect(f1.init).toHaveBeenCalledWith(ctx)
    expect(f1.registerIpc).toHaveBeenCalledOnce()
    expect(f2.init).toHaveBeenCalledWith(ctx)
  })

  it('聚合所有 feature 的 seedAgents(保序)', () => {
    const f1 = feature('a', { seedAgents: () => [{ id: 'x', dir: '/x' }] })
    const f2 = feature('b', { seedAgents: () => [{ id: 'y', dir: '/y' }] })
    const f3 = feature('c') // 无 seedAgents
    expect(installFeatures([f1, f2, f3], ctx)).toEqual([
      { id: 'x', dir: '/x' },
      { id: 'y', dir: '/y' },
    ])
  })

  it('空列表 → 空种子,不抛', () => {
    expect(installFeatures([], ctx)).toEqual([])
  })
})
