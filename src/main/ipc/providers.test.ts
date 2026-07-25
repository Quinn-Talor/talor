import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockHandle, mockGet, mockSet } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockGet: vi.fn(),
  mockSet: vi.fn(),
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
