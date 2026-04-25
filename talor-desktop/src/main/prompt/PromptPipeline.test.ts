import { describe, it, expect, vi } from 'vitest'
import { resolveProviderConfig } from './PromptPipeline'
import type { Provider } from '../store/config-store'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1', type: 'ollama', name: 'test', base_url: '', models: [],
    enabled: true, is_default: true, supports_vision: false,
    created_at: '', updated_at: '',
    ...overrides,
  }
}

const mockGet = vi.fn((key: string) => key === 'default_context_limit' ? undefined : undefined)
const mockInstance = { get: mockGet }

vi.mock('../store/config-store', () => ({
  ConfigStore: {
    getInstance: vi.fn(() => mockInstance),
  },
}))

import { ConfigStore } from '../store/config-store'

describe('resolveProviderConfig', () => {
  it('AC-002-01: provider.context_limit 优先', () => {
    mockGet.mockReturnValue(8000)
    const cfg = resolveProviderConfig(makeProvider({ context_limit: 16000 }))
    expect(cfg.context_limit).toBe(16000)
  })

  it('AC-002-02: provider 无配置时使用 appConfig 默认', () => {
    mockGet.mockReturnValue(12000)
    const cfg = resolveProviderConfig(makeProvider())
    expect(cfg.context_limit).toBe(12000)
  })

  it('AC-002-03: appConfig 也无配置时使用硬编码兜底 8000', () => {
    mockGet.mockReturnValue(undefined)
    const cfg = resolveProviderConfig(makeProvider())
    expect(cfg.context_limit).toBe(8000)
  })

  it('recent_ratio 和 summary_ratio 使用默认值', () => {
    mockGet.mockReturnValue(undefined)
    const cfg = resolveProviderConfig(makeProvider())
    expect(cfg.recent_ratio).toBe(0.05)
    expect(cfg.summary_ratio).toBe(0.10)
  })
})
