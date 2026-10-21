import { describe, it, expect } from 'vitest'
import { ollamaAdapter } from './ollama-adapter'

describe('ollamaAdapter.applyReasoningConfig（AC-011）', () => {
  it('enabled:true + effort → providerOptions.ollama.reasoningEffort(/v1 的 reasoning_effort)', () => {
    const result = ollamaAdapter.applyReasoningConfig!(
      { enabled: true, effort: 'high' },
      {} as never,
    )
    expect(result).toEqual({ providerOptions: { ollama: { reasoningEffort: 'high' } } })
  })

  it('enabled:true 未指定 effort → medium', () => {
    const result = ollamaAdapter.applyReasoningConfig!({ enabled: true }, {} as never)
    expect(result).toEqual({ providerOptions: { ollama: { reasoningEffort: 'medium' } } })
  })

  it('enabled:false → 不下发(不触发)', () => {
    expect(ollamaAdapter.applyReasoningConfig!({ enabled: false }, {} as never)).toEqual({})
  })
})
