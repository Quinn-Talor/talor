import { describe, it, expect } from 'vitest'
import { ollamaAdapter } from './ollama-adapter'

describe('ollamaAdapter.applyReasoningConfig（AC-011）', () => {
  it('enabled:true → providerOptions.ollama.think = true', () => {
    const result = ollamaAdapter.applyReasoningConfig!({ enabled: true }, {} as never)
    expect(result).toEqual({ providerOptions: { ollama: { think: true } } })
  })

  it('enabled:false → providerOptions.ollama.think = false（不触发）', () => {
    const result = ollamaAdapter.applyReasoningConfig!({ enabled: false }, {} as never)
    expect(result).toEqual({ providerOptions: { ollama: { think: false } } })
  })

  it('budgetTokens/effort 被忽略（ollama-ai-provider-v2 只支持 boolean，边界）', () => {
    const result = ollamaAdapter.applyReasoningConfig!(
      { enabled: true, budgetTokens: 5000, effort: 'high' },
      {} as never,
    )
    expect(result).toEqual({ providerOptions: { ollama: { think: true } } })
  })
})
