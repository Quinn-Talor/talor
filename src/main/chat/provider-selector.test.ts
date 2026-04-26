import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet }) },
}))

import { getDefaultProvider } from './provider-selector'

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
  beforeEach(() => { mockGet.mockReset() })

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
