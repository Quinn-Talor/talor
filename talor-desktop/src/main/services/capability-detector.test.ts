/**
 * Tests for capability-detector service (IMPL-014, IMPL-016)
 * AC-011-01: Model capability auto-detection
 * AC-011-02: Capability detection failure handling (fallback strategy)
 */
import { describe, it, expect } from 'vitest'
import {
  detectModelCapabilities,
  getCapabilitiesWithFallback,
  VISION_MODEL_PATTERNS,
  TOOLS_MODEL_PATTERNS
} from './capability-detector'
import type { ModelInfo } from '../types/models'

// Helper to build a minimal ModelInfo
function makeModel(id: string, name: string, providerId = 'test-provider'): ModelInfo {
  return {
    id,
    name,
    provider_id: providerId,
    display_name: name,
    capabilities: [],
    supports_vision: false,
    supports_tools: false
  }
}

describe('detectModelCapabilities', () => {
  // AC-011-01: GPT-4o must support vision and tools
  it('returns vision + tools + text for gpt-4o', () => {
    const model = makeModel('openai/gpt-4o', 'gpt-4o')
    const caps = detectModelCapabilities(model)

    const types = caps.map(c => c.type)
    expect(types).toContain('text_generation')
    expect(types).toContain('image_understanding')
    expect(types).toContain('function_calling')

    const vision = caps.find(c => c.type === 'image_understanding')!
    expect(vision.supported).toBe(true)
    expect(vision.source).toBe('auto')
    expect(vision.category).toBe('vision')

    const tools = caps.find(c => c.type === 'function_calling')!
    expect(tools.supported).toBe(true)
    expect(tools.source).toBe('auto')
    expect(tools.category).toBe('tools')
  })

  // AC-011-01: GPT-4-vision must support vision
  it('detects vision for gpt-4-vision-preview', () => {
    const model = makeModel('openai/gpt-4-vision-preview', 'gpt-4-vision-preview')
    const caps = detectModelCapabilities(model)
    const vision = caps.find(c => c.type === 'image_understanding')!
    expect(vision.supported).toBe(true)
  })

  // Text-only model: qwen3:4b (basic ollama model)
  it('returns only text_generation for qwen3:4b', () => {
    const model = makeModel('ollama/qwen3:4b', 'qwen3:4b')
    const caps = detectModelCapabilities(model)

    const text = caps.find(c => c.type === 'text_generation')!
    expect(text.supported).toBe(true)
    expect(text.source).toBe('default')

    const vision = caps.find(c => c.type === 'image_understanding')
    expect(vision?.supported).toBeFalsy()
  })

  // Claude 3 Sonnet supports vision and tools
  it('detects vision + tools for claude-3-sonnet', () => {
    const model = makeModel('anthropic/claude-3-sonnet-20240229', 'claude-3-sonnet-20240229')
    const caps = detectModelCapabilities(model)

    const vision = caps.find(c => c.type === 'image_understanding')!
    expect(vision.supported).toBe(true)

    const tools = caps.find(c => c.type === 'function_calling')!
    expect(tools.supported).toBe(true)
  })

  // All capabilities have required fields
  it('every capability has required fields', () => {
    const model = makeModel('openai/gpt-4o', 'gpt-4o')
    const caps = detectModelCapabilities(model)
    for (const cap of caps) {
      expect(cap.category).toBeDefined()
      expect(cap.type).toBeDefined()
      expect(typeof cap.supported).toBe('boolean')
      expect(cap.description).toBeDefined()
      expect(cap.source).toBeDefined()
    }
  })

  // detected_at is an ISO timestamp when source is 'auto'
  it('sets detected_at for auto-detected capabilities', () => {
    const model = makeModel('openai/gpt-4o', 'gpt-4o')
    const caps = detectModelCapabilities(model)
    const autoCaps = caps.filter(c => c.source === 'auto')
    expect(autoCaps.length).toBeGreaterThan(0)
    for (const cap of autoCaps) {
      expect(cap.detected_at).toBeDefined()
      expect(() => new Date(cap.detected_at!).toISOString()).not.toThrow()
    }
  })
})

describe('getCapabilitiesWithFallback', () => {
  // AC-011-02: Fallback returns default capabilities when detection throws
  it('returns DEFAULT_MODEL_CAPABILITIES when fn throws', () => {
    const caps = getCapabilitiesWithFallback(() => {
      throw new Error('API error')
    })
    expect(caps.length).toBeGreaterThan(0)
    const text = caps.find(c => c.type === 'text_generation')!
    expect(text.supported).toBe(true)
    expect(text.source).toBe('default')
  })

  // AC-011-02: Fallback returns detection result when fn succeeds
  it('returns fn result when no error', () => {
    const model = makeModel('openai/gpt-4o', 'gpt-4o')
    const caps = getCapabilitiesWithFallback(() => detectModelCapabilities(model))
    const vision = caps.find(c => c.type === 'image_understanding')
    expect(vision?.supported).toBe(true)
  })
})

describe('pattern exports (sanity)', () => {
  it('exports VISION_MODEL_PATTERNS as non-empty array', () => {
    expect(Array.isArray(VISION_MODEL_PATTERNS)).toBe(true)
    expect(VISION_MODEL_PATTERNS.length).toBeGreaterThan(0)
  })

  it('exports TOOLS_MODEL_PATTERNS as non-empty array', () => {
    expect(Array.isArray(TOOLS_MODEL_PATTERNS)).toBe(true)
    expect(TOOLS_MODEL_PATTERNS.length).toBeGreaterThan(0)
  })
})
