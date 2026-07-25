import { describe, it, expect } from 'vitest'
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

describe('openaiAdapter.applyReasoningConfig（AC-010）', () => {
  it('标准端点 + enabled:true + effort:high → reasoningEffort:high', () => {
    const provider = makeProvider({ base_url: 'https://api.openai.com' })
    const result = openaiAdapter.applyReasoningConfig!({ enabled: true, effort: 'high' }, provider)
    expect(result).toEqual({ providerOptions: { openai: { reasoningEffort: 'high' } } })
  })

  it('标准端点 + enabled:false → reasoningEffort:none（不触发）', () => {
    const provider = makeProvider({ base_url: 'https://api.openai.com' })
    const result = openaiAdapter.applyReasoningConfig!({ enabled: false }, provider)
    expect(result).toEqual({ providerOptions: { openai: { reasoningEffort: 'none' } } })
  })

  it('非标准端点(disable-thinking 已启用) + enabled:false → 返回空对象(已由 fetch 拦截处理，边界)', () => {
    const provider = makeProvider({
      base_url: 'https://deepseek.example.com',
      middleware: ['disable-thinking'],
    })
    const result = openaiAdapter.applyReasoningConfig!({ enabled: false }, provider)
    expect(result).toEqual({})
  })
})
