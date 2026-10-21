import { describe, it, expect, vi, beforeEach } from 'vitest'

const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    createOpenAI: vi.fn(),
    buildDisableThinkingFetch: vi.fn(() => 'disable-thinking-fetch'),
  },
}))

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: hoisted.createOpenAI }))
vi.mock('../../services/safe-storage', () => ({
  SafeStorageService: { getInstance: () => ({ getApiKey: () => 'sk-test' }) },
}))
vi.mock('../middleware', () => ({
  buildDisableThinkingFetch: hoisted.buildDisableThinkingFetch,
  shouldDisableThinking: (names: string[] | undefined) => !!names?.includes('disable-thinking'),
  wrapModel: (m: unknown) => m,
}))

import { openaiAdapter } from './openai-adapter'
import type { Provider } from '../../store/config-store'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
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

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.createOpenAI.mockReturnValue({ chat: (id: string) => ({ modelId: id }) })
})

describe('openaiAdapter.applyReasoningConfig（AC-010）', () => {
  it('enabled:true + effort:high → reasoningEffort:high', () => {
    const result = openaiAdapter.applyReasoningConfig!(
      { enabled: true, effort: 'high' },
      makeProvider(),
    )
    expect(result).toEqual({ providerOptions: { openai: { reasoningEffort: 'high' } } })
  })

  it('enabled:true 未指定 effort → medium', () => {
    const result = openaiAdapter.applyReasoningConfig!({ enabled: true }, makeProvider())
    expect(result).toEqual({ providerOptions: { openai: { reasoningEffort: 'medium' } } })
  })

  it('enabled:false → 不下发 reasoningEffort(none 仅少数模型接受,不触发)', () => {
    const result = openaiAdapter.applyReasoningConfig!({ enabled: false }, makeProvider())
    expect(result).toEqual({})
  })
})

describe('openaiAdapter.createModel — baseURL 与 disable-thinking', () => {
  function createdOpts(): { baseURL: string; fetch?: unknown } {
    return hoisted.createOpenAI.mock.calls[0][0]
  }

  it.each([
    ['https://api.openai.com', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
  ])('base_url %s → baseURL %s(不重复拼 /v1)', (input, expected) => {
    openaiAdapter.createModel(makeProvider({ base_url: input }), 'openai/gpt-4o')
    expect(createdOpts().baseURL).toBe(expected)
  })

  it('兼容端点 + 推理未启用 → 默认安装 disable-thinking fetch', () => {
    openaiAdapter.createModel(makeProvider({ base_url: 'https://api.deepseek.com' }), 'm')
    expect(createdOpts().fetch).toBe('disable-thinking-fetch')
  })

  it('兼容端点 + 推理已启用 → 不安装 disable-thinking(不吞掉 reasoning_effort)', () => {
    openaiAdapter.createModel(
      makeProvider({ base_url: 'https://api.deepseek.com', reasoning: { enabled: true } }),
      'm',
    )
    expect(createdOpts().fetch).toBeUndefined()
  })

  it('显式 middleware 含 disable-thinking + 推理已启用 → 同样不安装', () => {
    openaiAdapter.createModel(
      makeProvider({
        base_url: 'https://api.deepseek.com',
        middleware: ['disable-thinking'],
        reasoning: { enabled: true },
      }),
      'm',
    )
    expect(createdOpts().fetch).toBeUndefined()
  })

  it('api.openai.com → 不安装 disable-thinking', () => {
    openaiAdapter.createModel(makeProvider(), 'openai/gpt-4o')
    expect(createdOpts().fetch).toBeUndefined()
  })
})
