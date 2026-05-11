// src/main/providers/registry.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  listRegisteredModels,
  getRegisteredModelSet,
  isRegisteredModel,
} from './registry'

describe('Provider registry (schema 1.0)', () => {
  it('AC-090: DEFAULT_MODEL is claude-opus-4-7', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-4-7')
  })

  it('DEFAULT_PROVIDER is anthropic', () => {
    expect(DEFAULT_PROVIDER).toBe('anthropic')
  })

  it('DEFAULT_MODEL is registered', () => {
    expect(isRegisteredModel(DEFAULT_MODEL)).toBe(true)
  })

  it('AC-093: obsolete model claude-3-opus is NOT registered', () => {
    expect(isRegisteredModel('claude-3-opus')).toBe(false)
    expect(isRegisteredModel('claude-3-sonnet')).toBe(false)
    expect(isRegisteredModel('claude-3-5-sonnet')).toBe(false)
  })

  it('listRegisteredModels returns non-empty list including current Claude latest', () => {
    const list = listRegisteredModels()
    expect(list.length).toBeGreaterThan(0)
    expect(list).toContain('claude-opus-4-7')
    expect(list).toContain('claude-sonnet-4-6')
  })

  it('getRegisteredModelSet shares list contents', () => {
    const set = getRegisteredModelSet()
    expect(set.has('claude-opus-4-7')).toBe(true)
    expect(set.has('xxx-not-real')).toBe(false)
  })
})

describe('AC-091/AC-092: integration with validator §12', async () => {
  const { validateProfile } = await import('../agent/validator')

  const baseProfile = {
    schemaVersion: '2.0',
    id: 'a',
    name: 'A',
    description: 'd',
    version: '1.0.0',
    agentPrompt: '## Workflow\n1. Do task.',
  }

  it('AC-092: profile with locked DEFAULT_MODEL passes validator', () => {
    const r = validateProfile(
      { ...baseProfile, preferences: { modelId: DEFAULT_MODEL } },
      { knownModelIds: getRegisteredModelSet() as Set<string> },
    )
    expect(r.valid).toBe(true)
  })

  it('AC-093 integration: profile with obsolete model fails validator', () => {
    const r = validateProfile(
      { ...baseProfile, preferences: { modelId: 'claude-3-opus' } },
      { knownModelIds: getRegisteredModelSet() as Set<string> },
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.path === 'preferences.modelId')).toBe(true)
    }
  })
})
