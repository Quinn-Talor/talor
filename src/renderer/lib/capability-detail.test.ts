/**
 * Tests for capability-detail helper (IMPL-017)
 * AC-011-03: Model capability detail display
 *   - Given: user views a model with vision capability
 *   - When: user clicks capability detail
 *   - Then: sees detailed description, "支持分析 PNG、JPEG 格式图片", and test link hint
 */
import { describe, it, expect } from 'vitest'
import { getCapabilityDetail } from './capability-detail'
import type { ModelCapability } from '../types/models'

function makeCapability(
  category: ModelCapability['category'],
  type: string,
  supported = true
): ModelCapability {
  return { category, type, supported, description: '', source: 'auto' }
}

describe('getCapabilityDetail', () => {
  describe('vision / image_understanding', () => {
    it('returns label in Chinese', () => {
      const cap = makeCapability('vision', 'image_understanding')
      const detail = getCapabilityDetail(cap)
      expect(detail.label).toBe('图片理解')
    })

    it('includes PNG and JPEG format mention (AC-011-03 explicit requirement)', () => {
      const cap = makeCapability('vision', 'image_understanding')
      const detail = getCapabilityDetail(cap)
      expect(detail.description).toMatch(/PNG/)
      expect(detail.description).toMatch(/JPEG/)
    })

    it('provides a non-empty test hint for navigating to test', () => {
      const cap = makeCapability('vision', 'image_understanding')
      const detail = getCapabilityDetail(cap)
      expect(detail.testHint).toBeTruthy()
    })

    it('provides at least one usage example', () => {
      const cap = makeCapability('vision', 'image_understanding')
      const detail = getCapabilityDetail(cap)
      expect(detail.examples.length).toBeGreaterThan(0)
    })
  })

  describe('tools / function_calling', () => {
    it('returns Chinese label for function_calling', () => {
      const cap = makeCapability('tools', 'function_calling')
      const detail = getCapabilityDetail(cap)
      expect(detail.label).toBe('工具调用')
    })

    it('returns description with usage info', () => {
      const cap = makeCapability('tools', 'function_calling')
      const detail = getCapabilityDetail(cap)
      expect(detail.description.length).toBeGreaterThan(0)
    })
  })

  describe('text / text_generation', () => {
    it('returns Chinese label', () => {
      const cap = makeCapability('text', 'text_generation')
      const detail = getCapabilityDetail(cap)
      expect(detail.label).toBe('文本生成')
    })

    it('has description and examples', () => {
      const cap = makeCapability('text', 'text_generation')
      const detail = getCapabilityDetail(cap)
      expect(detail.description.length).toBeGreaterThan(0)
      expect(detail.examples.length).toBeGreaterThan(0)
    })
  })

  describe('unsupported capability', () => {
    it('marks not-supported caps with supported=false in detail', () => {
      const cap = makeCapability('vision', 'image_understanding', false)
      const detail = getCapabilityDetail(cap)
      expect(detail.supported).toBe(false)
    })
  })

  describe('unknown capability type', () => {
    it('returns fallback detail without crashing', () => {
      const cap = makeCapability('audio', 'audio_transcription')
      const detail = getCapabilityDetail(cap)
      expect(detail.label).toBeTruthy()
      expect(detail.description).toBeTruthy()
    })
  })
})
