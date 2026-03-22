import { describe, it, expect } from 'vitest'
import { checkModelAvailability } from './model-availability'
import type { ModelInfo } from '../types/models'

const makeModel = (id: string): ModelInfo => ({
  id,
  name: id.split('/')[1] ?? id,
  provider_id: id.split('/')[0] ?? 'p1',
  display_name: id,
  description: '',
  capabilities: [],
  supports_vision: false,
  supports_tools: false,
})

describe('checkModelAvailability', () => {
  it('returns available=true when model_id exists in provider models', () => {
    const models = [makeModel('openai/gpt-4o'), makeModel('openai/gpt-3.5')]
    const result = checkModelAvailability('openai/gpt-4o', models)
    expect(result.available).toBe(true)
    expect(result.model?.id).toBe('openai/gpt-4o')
  })

  it('returns available=false when model_id is not in provider models', () => {
    const models = [makeModel('openai/gpt-3.5')]
    const result = checkModelAvailability('openai/gpt-4o', models)
    expect(result.available).toBe(false)
    expect(result.model).toBeUndefined()
  })

  it('returns available=false when model_id is undefined', () => {
    const models = [makeModel('openai/gpt-4o')]
    const result = checkModelAvailability(undefined, models)
    expect(result.available).toBe(false)
  })

  it('returns available=false when models list is empty', () => {
    const result = checkModelAvailability('openai/gpt-4o', [])
    expect(result.available).toBe(false)
  })
})
