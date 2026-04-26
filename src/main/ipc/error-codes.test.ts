import { describe, it, expect } from 'vitest'
import { classifyLlmError } from './error-codes'

describe('classifyLlmError', () => {
  it('classifies 429 response as RATE_LIMITED', () => {
    expect(classifyLlmError(new Error('HTTP 429 Too Many Requests'))).toBe('RATE_LIMITED')
  })

  it('classifies rate limit message as RATE_LIMITED', () => {
    expect(classifyLlmError(new Error('You have exceeded your rate limit'))).toBe('RATE_LIMITED')
  })

  it('classifies too many requests as RATE_LIMITED', () => {
    expect(classifyLlmError(new Error('Too Many Requests'))).toBe('RATE_LIMITED')
  })

  it('classifies ECONNREFUSED as LLM_CONNECTION_FAILED', () => {
    expect(classifyLlmError(new Error('ECONNREFUSED'))).toBe('LLM_CONNECTION_FAILED')
  })

  it('classifies 401 as AUTH_FAILED', () => {
    expect(classifyLlmError(new Error('HTTP 401 Unauthorized'))).toBe('AUTH_FAILED')
  })

  it('classifies API key error as AUTH_FAILED', () => {
    expect(classifyLlmError(new Error('Invalid API key provided'))).toBe('AUTH_FAILED')
  })

  it('defaults to LLM_ERROR for unknown errors', () => {
    expect(classifyLlmError(new Error('Something went wrong'))).toBe('LLM_ERROR')
  })

  it('TimeoutError 分类为 LLM_TIMEOUT', () => {
    const err = new DOMException('signal timed out', 'TimeoutError')
    expect(classifyLlmError(err)).toBe('LLM_TIMEOUT')
  })

  it('AbortError 分类为 LLM_TIMEOUT', () => {
    const err = new DOMException('The user aborted a request.', 'AbortError')
    expect(classifyLlmError(err)).toBe('LLM_TIMEOUT')
  })

  it('映射 FILE_TOO_LARGE / UNSUPPORTED_FILE_TYPE / FILE_NOT_FOUND / PROVIDER_NO_VISION 原样', () => {
    expect(classifyLlmError(new Error('FILE_TOO_LARGE'))).toBe('FILE_TOO_LARGE')
    expect(classifyLlmError(new Error('UNSUPPORTED_FILE_TYPE'))).toBe('UNSUPPORTED_FILE_TYPE')
    expect(classifyLlmError(new Error('FILE_NOT_FOUND'))).toBe('FILE_NOT_FOUND')
    expect(classifyLlmError(new Error('PROVIDER_NO_VISION'))).toBe('PROVIDER_NO_VISION')
  })
})
