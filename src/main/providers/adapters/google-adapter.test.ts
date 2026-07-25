import { describe, it, expect } from 'vitest'
import { googleAdapter } from './google-adapter'

describe('googleAdapter.applyReasoningConfig（AC-009）', () => {
  it('enabled:true + budgetTokens + effort → thinkingConfig 正确翻译', () => {
    const result = googleAdapter.applyReasoningConfig!(
      { enabled: true, budgetTokens: 1000, effort: 'high' },
      {} as never,
    )
    expect(result).toEqual({
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 1000, thinkingLevel: 'high' } },
      },
    })
  })

  it('effort 未指定 → thinkingLevel 为 undefined（边界）', () => {
    const result = googleAdapter.applyReasoningConfig!(
      { enabled: true, budgetTokens: 500 },
      {} as never,
    )
    expect(result).toEqual({
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 500, thinkingLevel: undefined } },
      },
    })
  })

  it('enabled:false → thinkingConfig:{thinkingBudget:0}（不触发）', () => {
    const result = googleAdapter.applyReasoningConfig!({ enabled: false }, {} as never)
    expect(result).toEqual({
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    })
  })
})
