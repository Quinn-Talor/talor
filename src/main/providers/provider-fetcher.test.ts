import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isCacheValid, CACHE_TTL_MS } from './provider-fetcher'

describe('isCacheValid', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when lastUpdated is undefined', () => {
    expect(isCacheValid(undefined)).toBe(false)
  })

  it('returns false when lastUpdated is null', () => {
    expect(isCacheValid(null as unknown as undefined)).toBe(false)
  })

  it('returns true when lastUpdated is within TTL', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const lastUpdated = new Date(now - CACHE_TTL_MS + 1000).toISOString() // 1 second before expiry
    expect(isCacheValid(lastUpdated)).toBe(true)
  })

  it('returns false when lastUpdated equals exactly TTL ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const lastUpdated = new Date(now - CACHE_TTL_MS).toISOString() // exactly at TTL boundary
    expect(isCacheValid(lastUpdated)).toBe(false)
  })

  it('returns false when lastUpdated is older than TTL', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const lastUpdated = new Date(now - CACHE_TTL_MS - 60_000).toISOString() // 1 minute past expiry
    expect(isCacheValid(lastUpdated)).toBe(false)
  })

  it('returns true when lastUpdated is just now', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const lastUpdated = new Date(now).toISOString()
    expect(isCacheValid(lastUpdated)).toBe(true)
  })

  it('returns false when lastUpdated is in the future (clock skew)', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const lastUpdated = new Date(now + 60_000).toISOString() // 1 minute in the future
    // Future timestamps should not be considered valid cache (treat as invalid)
    expect(isCacheValid(lastUpdated)).toBe(false)
  })
})
