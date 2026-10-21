import { describe, it, expect } from 'vitest'
import { buildAuthHeaders, modelsEndpoint, normalizeBaseUrl, ollamaRootUrl } from './base-url'

describe('normalizeBaseUrl', () => {
  it.each([
    ['openai', 'https://api.openai.com', 'https://api.openai.com/v1'],
    ['openai', 'https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['openai', 'https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['openai', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'],
    ['anthropic', 'https://api.anthropic.com', 'https://api.anthropic.com/v1'],
    ['anthropic', 'https://api.anthropic.com/v1', 'https://api.anthropic.com/v1'],
    [
      'google',
      'https://generativelanguage.googleapis.com',
      'https://generativelanguage.googleapis.com/v1beta',
    ],
    [
      'google',
      'https://generativelanguage.googleapis.com/v1beta/',
      'https://generativelanguage.googleapis.com/v1beta',
    ],
    ['ollama', 'http://localhost:11434', 'http://localhost:11434/v1'],
    ['ollama', 'http://localhost:11434/v1', 'http://localhost:11434/v1'],
  ])('%s %s → %s', (type, input, expected) => {
    expect(normalizeBaseUrl(type, input)).toBe(expected)
  })

  it('幂等:对结果再规范化不变', () => {
    for (const type of ['openai', 'anthropic', 'google', 'ollama']) {
      const once = normalizeBaseUrl(type, 'https://example.com')
      expect(normalizeBaseUrl(type, once)).toBe(once)
    }
  })

  it('空 base_url → 官方默认地址', () => {
    expect(normalizeBaseUrl('anthropic', '')).toBe('https://api.anthropic.com/v1')
    expect(normalizeBaseUrl('google', undefined)).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    )
  })

  it('未知类型按 openai 兼容处理', () => {
    expect(normalizeBaseUrl('custom', 'https://x.example')).toBe('https://x.example/v1')
  })
})

describe('ollamaRootUrl / modelsEndpoint', () => {
  it('ollama 原生接口挂在根下(去掉 /v1)', () => {
    expect(ollamaRootUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434')
    expect(modelsEndpoint('ollama', 'http://localhost:11434/v1')).toBe(
      'http://localhost:11434/api/tags',
    )
  })

  it('其他类型 = 规范化 API 根 + /models', () => {
    expect(modelsEndpoint('anthropic', 'https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/models',
    )
    expect(modelsEndpoint('openai', 'https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/models',
    )
  })
})

describe('buildAuthHeaders', () => {
  it('openai → Bearer', () => {
    expect(buildAuthHeaders('openai', 'k')).toEqual({ Authorization: 'Bearer k' })
  })

  it('anthropic → x-api-key + anthropic-version(不发 Bearer)', () => {
    expect(buildAuthHeaders('anthropic', 'k')).toEqual({
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    })
  })

  it('google → x-goog-api-key', () => {
    expect(buildAuthHeaders('google', 'k')).toEqual({ 'x-goog-api-key': 'k' })
  })

  it('无 key 不发鉴权头', () => {
    expect(buildAuthHeaders('openai', undefined)).toEqual({})
  })
})
