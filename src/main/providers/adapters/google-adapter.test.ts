import { describe, it, expect } from 'vitest'
import { googleAdapter } from './google-adapter'

const apply = (
  config: Parameters<NonNullable<typeof googleAdapter.applyReasoningConfig>>[0],
  modelId?: string,
) => googleAdapter.applyReasoningConfig!(config, {} as never, modelId)

describe('googleAdapter.applyReasoningConfig（AC-009）', () => {
  it('Gemini 2.5 + 显式 budgetTokens → thinkingConfig.thinkingBudget(不发 thinkingLevel)', () => {
    expect(
      apply({ enabled: true, budgetTokens: 1000, effort: 'high' }, 'google/gemini-2.5-flash'),
    ).toEqual({
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 1000 } } },
    })
  })

  it('Gemini 3 + 显式 budgetTokens → 仍走顶层 reasoning 档位(SDK 映射为 thinkingLevel)', () => {
    expect(
      apply({ enabled: true, budgetTokens: 1000, effort: 'high' }, 'gemini-3-pro-preview'),
    ).toEqual({
      reasoning: 'high',
    })
  })

  it('无 budgetTokens → 顶层 reasoning 档位,未指定 effort 时 medium', () => {
    expect(apply({ enabled: true }, 'gemini-2.5-flash')).toEqual({ reasoning: 'medium' })
  })

  it('enabled:false → 顶层 reasoning none(不触发)', () => {
    expect(apply({ enabled: false }, 'gemini-2.5-flash')).toEqual({ reasoning: 'none' })
  })

  it('enabled:false + 仅思考模式模型(2.5 Pro)→ 不下发(budget 0 会被拒绝)', () => {
    expect(apply({ enabled: false }, 'google/gemini-2.5-pro')).toEqual({})
  })
})
