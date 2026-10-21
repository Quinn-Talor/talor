import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockHandle, mockGet, mockSet, mockFetchModels, mockTest, mockGetApiKey } = vi.hoisted(
  () => ({
    mockHandle: vi.fn(),
    mockGet: vi.fn(),
    mockSet: vi.fn(),
    mockFetchModels: vi.fn(),
    mockTest: vi.fn(),
    mockGetApiKey: vi.fn(),
  }),
)

vi.mock('../providers/provider-fetcher', () => ({
  getProviderModels: (...args: unknown[]) => mockFetchModels(...args),
  isCacheValid: () => false,
}))

vi.mock('../providers/provider-tester', () => ({
  testConnection: (...args: unknown[]) => mockTest(...args),
}))

vi.mock('../services/safe-storage', () => ({
  SafeStorageService: {
    getInstance: () => ({
      getApiKey: mockGetApiKey,
      setApiKey: vi.fn(),
      removeApiKey: vi.fn(),
    }),
  },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet, set: mockSet }) },
}))

import { registerProviderHandlers } from './providers'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`handler not registered for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('providers:create / providers:update — reasoning 字段透传（AC-004, AC-005）', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    mockGet.mockReset()
    mockSet.mockReset()
    registerProviderHandlers()
  })

  it('(AC-004) providers:create 传 reasoning → 返回的 provider.reasoning 等于输入', () => {
    mockGet.mockReturnValue({})
    const create = getHandler('providers:create')
    const result = create(null, {
      type: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com',
      enabled: true,
      is_default: true,
      reasoning: { enabled: true, effort: 'high' },
    }) as { reasoning?: unknown }
    expect(result.reasoning).toEqual({ enabled: true, effort: 'high' })
  })

  it('(AC-005) providers:update 不传 reasoning → 保留数据库原值不被清空', () => {
    mockGet.mockReturnValue({
      p1: {
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
        reasoning: { enabled: true, effort: 'low' },
      },
    })
    const update = getHandler('providers:update')
    const result = update(null, 'p1', {
      type: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com',
      enabled: true,
      is_default: true,
    }) as { reasoning?: unknown }
    expect(result.reasoning).toEqual({ enabled: true, effort: 'low' })
  })

  it('(AC-005) providers:update 传 reasoning → 整体替换为新值', () => {
    mockGet.mockReturnValue({
      p1: {
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
        reasoning: { enabled: true, effort: 'low' },
      },
    })
    const update = getHandler('providers:update')
    const result = update(null, 'p1', {
      type: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com',
      enabled: true,
      is_default: true,
      reasoning: { enabled: false },
    }) as { reasoning?: unknown }
    expect(result.reasoning).toEqual({ enabled: false })
  })
})

describe('providers model fetching', () => {
  const base = {
    type: 'ollama',
    base_url: 'http://localhost:11434',
    enabled: true,
    is_default: false,
  }
  beforeEach(() => {
    mockHandle.mockClear()
    mockGet.mockReset()
    mockSet.mockReset()
    mockFetchModels.mockReset()
    registerProviderHandlers()
  })

  it('getModels serves the stored list when the provider is unreachable', async () => {
    const stored = [{ id: 'llama3' }]
    mockGet.mockReturnValue({ p1: { ...base, id: 'p1', name: 'A', models: stored } })
    mockFetchModels.mockRejectedValue(new Error('ECONNREFUSED'))
    const r = (await getHandler('providers:getModels')(null, 'p1')) as { models: unknown }
    expect(r.models).toEqual(stored)
  })

  it('getModels still throws when there is nothing stored to fall back to', async () => {
    mockGet.mockReturnValue({ p1: { ...base, id: 'p1', name: 'A', models: [] } })
    mockFetchModels.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(getHandler('providers:getModels')(null, 'p1')).rejects.toThrow('ECONNREFUSED')
  })

  it('writes fetched models into the latest store state, not the pre-fetch snapshot', async () => {
    const before = {
      p1: { ...base, id: 'p1', name: 'A', models: [] },
      p2: { ...base, id: 'p2', name: 'B', models: [] },
    }
    // p2 在拉取期间被删除
    const after = { p1: before.p1 }
    mockGet.mockReturnValueOnce(before).mockReturnValue(after)
    mockFetchModels.mockResolvedValue([{ id: 'm1' }])
    await getHandler('providers:refreshModels')(null, 'p1')
    const written = mockSet.mock.calls.at(-1)?.[1] as Record<string, { models: unknown }>
    expect(Object.keys(written)).toEqual(['p1'])
    expect(written.p1.models).toEqual([{ id: 'm1' }])
  })
})

describe('providers:testConnection uses the stored key when none is typed', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    mockTest.mockReset()
    mockGetApiKey.mockReset()
    registerProviderHandlers()
  })

  it('falls back to the SafeStorage key by provider_id', () => {
    mockGetApiKey.mockReturnValue('sk-stored')
    getHandler('providers:testConnection')(null, {
      type: 'openai',
      base_url: 'https://api.openai.com',
      provider_id: 'p1',
    })
    expect(mockTest).toHaveBeenCalledWith({
      type: 'openai',
      base_url: 'https://api.openai.com',
      api_key: 'sk-stored',
    })
  })

  it('a typed key wins over the stored one', () => {
    mockGetApiKey.mockReturnValue('sk-stored')
    getHandler('providers:testConnection')(null, {
      type: 'openai',
      base_url: 'https://api.openai.com',
      api_key: 'sk-new',
      provider_id: 'p1',
    })
    expect(mockTest).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'sk-new' }))
  })
})
