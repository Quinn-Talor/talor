import { describe, it, expect } from 'vitest'
import { applyManualCapabilities } from './updater'
import type { ModelCapability } from '@shared/types/models'

const BASE_CAPS: ModelCapability[] = [
  {
    category: 'text',
    type: 'text_generation',
    supported: true,
    description: '文本生成',
    source: 'auto',
  },
  {
    category: 'vision',
    type: 'image_understanding',
    supported: false,
    description: '图片理解',
    source: 'auto',
  },
]

describe('applyManualCapabilities', () => {
  it('marks all capabilities as source=manual', () => {
    const result = applyManualCapabilities(BASE_CAPS)
    expect(result.every((c) => c.source === 'manual')).toBe(true)
  })

  it('sets detected_at timestamp on all capabilities', () => {
    const result = applyManualCapabilities(BASE_CAPS)
    expect(result.every((c) => typeof c.detected_at === 'string' && c.detected_at.length > 0)).toBe(
      true,
    )
  })

  it('preserves supported flag from input', () => {
    const caps: ModelCapability[] = [
      {
        category: 'vision',
        type: 'image_understanding',
        supported: true,
        description: '图片理解',
        source: 'auto',
      },
    ]
    const result = applyManualCapabilities(caps)
    expect(result[0].supported).toBe(true)
  })

  it('preserves all capability fields (category, type, description)', () => {
    const result = applyManualCapabilities(BASE_CAPS)
    expect(result[0].category).toBe('text')
    expect(result[0].type).toBe('text_generation')
    expect(result[0].description).toBe('文本生成')
  })

  it('returns empty array when input is empty', () => {
    expect(applyManualCapabilities([])).toEqual([])
  })

  it('uses consistent timestamp for all capabilities in one call', () => {
    const result = applyManualCapabilities(BASE_CAPS)
    const timestamps = result.map((c) => c.detected_at)
    expect(timestamps[0]).toBe(timestamps[1])
  })

  it('overrides existing source=default to manual', () => {
    const caps: ModelCapability[] = [
      {
        category: 'text',
        type: 'text_generation',
        supported: true,
        description: '文本',
        source: 'default',
      },
    ]
    const result = applyManualCapabilities(caps)
    expect(result[0].source).toBe('manual')
  })
})
