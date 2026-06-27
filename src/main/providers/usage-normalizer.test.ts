import { describe, it, expect } from 'vitest'
import { normalizeUsage } from './usage-normalizer'

describe('normalizeUsage', () => {
  it('subtracts anthropic cache tokens from inclusive inputTokens', () => {
    const u = normalizeUsage(
      { inputTokens: 1000, outputTokens: 200 },
      { anthropic: { cacheReadInputTokens: 600, cacheCreationInputTokens: 100 } },
    )
    expect(u.cacheReadTokens).toBe(600)
    expect(u.cacheWriteTokens).toBe(100)
    expect(u.inputTokens).toBe(300)
    expect(u.outputTokens).toBe(200)
  })

  it('reads openai cached tokens without needing providerType', () => {
    const u = normalizeUsage({ inputTokens: 500, outputTokens: 50 }, { openai: { cachedPromptTokens: 200 } })
    expect(u.cacheReadTokens).toBe(200)
    expect(u.inputTokens).toBe(300)
  })

  it('handles missing usage / metadata', () => {
    const u = normalizeUsage(undefined, undefined)
    expect(u.inputTokens).toBe(0)
    expect(u.outputTokens).toBe(0)
  })

  it('never returns negative non-cached input', () => {
    const u = normalizeUsage({ inputTokens: 100 }, { anthropic: { cacheReadInputTokens: 999 } })
    expect(u.inputTokens).toBe(0)
  })
})
