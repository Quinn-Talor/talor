import { describe, it, expect } from 'vitest'
import { anthropicAdapter } from './anthropic-adapter'

describe('anthropicAdapter.applyReasoningConfig（AC-008）', () => {
  it('显式 budgetTokens 优先于 effort 映射', () => {
    const result = anthropicAdapter.applyReasoningConfig!(
      { enabled: true, budgetTokens: 2000, effort: 'low' },
      {} as never,
    )
    expect(result).toEqual({
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2000 } } },
    })
  })

  it('无显式 budgetTokens 时按 effort 档位映射（high→8192）', () => {
    const result = anthropicAdapter.applyReasoningConfig!(
      { enabled: true, effort: 'high' },
      {} as never,
    )
    expect(result).toEqual({
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } } },
    })
  })

  it('无 budgetTokens 也无 effort → 默认按 medium 映射（边界）', () => {
    const result = anthropicAdapter.applyReasoningConfig!({ enabled: true }, {} as never)
    expect(result).toEqual({
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } },
    })
  })

  it('enabled:false → thinking:{type:disabled}（不触发）', () => {
    const result = anthropicAdapter.applyReasoningConfig!({ enabled: false }, {} as never)
    expect(result).toEqual({ providerOptions: { anthropic: { thinking: { type: 'disabled' } } } })
  })
})
