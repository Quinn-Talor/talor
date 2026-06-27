import { describe, it, expect } from 'vitest'
import { normalizeUsage } from './usage-normalizer'

describe('normalizeUsage', () => {
  it('prefers v7 inputTokenDetails (noCacheTokens + cache read/write)', () => {
    const u = normalizeUsage(
      {
        inputTokens: 1000,
        outputTokens: 120,
        inputTokenDetails: { noCacheTokens: 300, cacheReadTokens: 600, cacheWriteTokens: 100 },
      },
      undefined,
    )
    expect(u.inputTokens).toBe(300)
    expect(u.cacheReadTokens).toBe(600)
    expect(u.cacheWriteTokens).toBe(100)
    expect(u.outputTokens).toBe(120)
  })

  it('inputTokenDetails takes precedence over providerMetadata', () => {
    const u = normalizeUsage(
      { inputTokens: 800, outputTokens: 10, inputTokenDetails: { cacheReadTokens: 700 } },
      { anthropic: { cacheReadInputTokens: 999 } }, // should be ignored
    )
    expect(u.cacheReadTokens).toBe(700)
    expect(u.inputTokens).toBe(100) // 800 - 700
  })

  it('falls back to deepseek providerMetadata when no inputTokenDetails', () => {
    const u = normalizeUsage(
      { inputTokens: 500, outputTokens: 5 },
      { deepseek: { promptCacheHitTokens: 400, promptCacheMissTokens: 100 } },
    )
    expect(u.cacheReadTokens).toBe(400)
    expect(u.inputTokens).toBe(100)
  })

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
    const u = normalizeUsage(
      { inputTokens: 500, outputTokens: 50 },
      { openai: { cachedPromptTokens: 200 } },
    )
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
