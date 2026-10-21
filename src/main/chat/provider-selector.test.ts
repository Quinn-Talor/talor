import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet }) },
}))

import {
  getDefaultProvider,
  getProviderById,
  resolveSessionProviderModel,
} from './provider-selector'

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    type: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com',
    models: [],
    enabled: true,
    is_default: true,
    supports_vision: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('getDefaultProvider', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('优先返回 is_default=true 且 enabled 的 provider', () => {
    mockGet.mockReturnValue({
      p1: makeProvider({ id: 'p1', is_default: false, enabled: true }),
      p2: makeProvider({ id: 'p2', is_default: true, enabled: true }),
    })
    expect(getDefaultProvider().id).toBe('p2')
  })

  it('无 default 时退回任一 enabled provider', () => {
    mockGet.mockReturnValue({
      p1: makeProvider({ id: 'p1', is_default: false, enabled: false }),
      p2: makeProvider({ id: 'p2', is_default: false, enabled: true }),
    })
    expect(getDefaultProvider().id).toBe('p2')
  })

  it('无任何可用 provider 时抛错', () => {
    mockGet.mockReturnValue({
      p1: makeProvider({ id: 'p1', is_default: false, enabled: false }),
    })
    expect(() => getDefaultProvider()).toThrow('No provider available')
  })

  it('providers 为空时抛错', () => {
    mockGet.mockReturnValue({})
    expect(() => getDefaultProvider()).toThrow('No provider available')
  })
})

describe('getProviderById', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('返回已启用的 provider', () => {
    mockGet.mockReturnValue({ p1: makeProvider({ id: 'p1', enabled: true }) })
    expect(getProviderById('p1')?.id).toBe('p1')
  })

  it('已禁用的 provider 返回 null(不被选用)', () => {
    mockGet.mockReturnValue({ p1: makeProvider({ id: 'p1', enabled: false }) })
    expect(getProviderById('p1')).toBeNull()
  })

  it('不存在返回 null', () => {
    mockGet.mockReturnValue({})
    expect(getProviderById('nope')).toBeNull()
  })
})

describe('resolveSessionProviderModel', () => {
  const models = (...ids: string[]) => ids.map((id) => ({ id, name: id.replace(/^\w+\//, '') }))

  beforeEach(() => {
    mockGet.mockReset()
  })

  it('session provider 可用 → 沿用 session.model_id(不回落)', () => {
    mockGet.mockReturnValue({
      a: makeProvider({ id: 'a', is_default: false, models: models('openai/gpt-a') }),
      d: makeProvider({ id: 'd', is_default: true, models: models('openai/gpt-d') }),
    })
    const r = resolveSessionProviderModel({ provider_id: 'a', model_id: 'openai/gpt-x' })
    expect(r).toMatchObject({ modelId: 'openai/gpt-x', fellBack: false })
    expect(r.provider.id).toBe('a')
  })

  it('session 未记录模型 → 取该 provider.models[0]', () => {
    mockGet.mockReturnValue({
      a: makeProvider({ id: 'a', models: models('openai/gpt-a', 'openai/gpt-b') }),
    })
    expect(resolveSessionProviderModel({ provider_id: 'a', model_id: null }).modelId).toBe(
      'openai/gpt-a',
    )
  })

  it('session provider 被删 → 回落默认 provider,模型也回落到其 models[0]', () => {
    mockGet.mockReturnValue({
      d: makeProvider({ id: 'd', type: 'anthropic', models: models('anthropic/claude-x') }),
    })
    const r = resolveSessionProviderModel({ provider_id: 'gone', model_id: 'openai/gpt-x' })
    expect(r.provider.id).toBe('d')
    expect(r.modelId).toBe('anthropic/claude-x')
    expect(r.fellBack).toBe(true)
  })

  it('session provider 被禁用 → 同样回落', () => {
    mockGet.mockReturnValue({
      a: makeProvider({ id: 'a', enabled: false, is_default: false, models: models('openai/a') }),
      d: makeProvider({ id: 'd', is_default: true, models: models('openai/d') }),
    })
    const r = resolveSessionProviderModel({ provider_id: 'a', model_id: 'openai/a' })
    expect(r.provider.id).toBe('d')
    expect(r.modelId).toBe('openai/d')
  })

  it('回落后 session.model_id 恰在默认 provider 列表中 → 沿用', () => {
    mockGet.mockReturnValue({
      d: makeProvider({ id: 'd', models: models('openai/d1', 'openai/shared') }),
    })
    expect(
      resolveSessionProviderModel({ provider_id: 'gone', model_id: 'openai/shared' }).modelId,
    ).toBe('openai/shared')
  })

  it('无任何可用模型 → 抛错', () => {
    mockGet.mockReturnValue({ d: makeProvider({ id: 'd', models: [] }) })
    expect(() => resolveSessionProviderModel({ provider_id: 'gone' })).toThrow(/No model/)
  })
})
