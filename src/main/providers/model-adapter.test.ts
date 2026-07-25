import { describe, it, expect } from 'vitest'
import { mergeProviderOptions, resolveStreamOptions, type ModelAdapter } from './model-adapter'
import type { Provider } from '../store/config-store'

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

describe('mergeProviderOptions（AC-006）', () => {
  it('按 provider-key 逐层合并，不互相覆盖', () => {
    const result = mergeProviderOptions(
      { providerOptions: { openai: { a: 1 } } },
      { providerOptions: { openai: { b: 2 } } },
    )
    expect(result).toEqual({ providerOptions: { openai: { a: 1, b: 2 } } })
  })

  it('不传任何参数 → 返回空 providerOptions（不触发）', () => {
    expect(mergeProviderOptions()).toEqual({ providerOptions: {} })
  })

  it('undefined 来源被跳过，不抛异常', () => {
    const result = mergeProviderOptions(undefined, { providerOptions: { anthropic: { x: 1 } } })
    expect(result).toEqual({ providerOptions: { anthropic: { x: 1 } } })
  })
})

describe('resolveStreamOptions（AC-007）', () => {
  it('provider.reasoning 为 undefined → 返回值与 adapter.buildStreamOptions() 完全一致（回归，不触发）', () => {
    const adapter: ModelAdapter = {
      createModel: () => ({}) as never,
      fetchModels: async () => [],
      buildStreamOptions: () => ({ providerOptions: { openai: { parallelToolCalls: true } } }),
      applyReasoningConfig: () => ({ providerOptions: { openai: { reasoningEffort: 'high' } } }),
    }
    const provider = makeProvider({ reasoning: undefined })
    expect(resolveStreamOptions(adapter, provider)).toEqual(adapter.buildStreamOptions())
  })

  it('adapter 未实现 applyReasoningConfig → 返回值与 buildStreamOptions() 一致（不触发）', () => {
    const adapter: ModelAdapter = {
      createModel: () => ({}) as never,
      fetchModels: async () => [],
      buildStreamOptions: () => ({}),
    }
    const provider = makeProvider({ reasoning: { enabled: true } })
    expect(resolveStreamOptions(adapter, provider)).toEqual({})
  })

  it('provider.reasoning 存在且 adapter 支持 → 合并 adapter 默认值与 reasoning 翻译', () => {
    const adapter: ModelAdapter = {
      createModel: () => ({}) as never,
      fetchModels: async () => [],
      buildStreamOptions: () => ({ providerOptions: { openai: { parallelToolCalls: true } } }),
      applyReasoningConfig: () => ({ providerOptions: { openai: { reasoningEffort: 'high' } } }),
    }
    const provider = makeProvider({ reasoning: { enabled: true, effort: 'high' } })
    expect(resolveStreamOptions(adapter, provider)).toEqual({
      providerOptions: { openai: { parallelToolCalls: true, reasoningEffort: 'high' } },
    })
  })
})
