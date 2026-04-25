import { describe, it, expect } from 'vitest'
import { toolResultPartsToBlocks, classifyLlmError, buildStreamSignal } from './chat-utils'

describe('toolResultPartsToBlocks', () => {
  it('sets isError=false for successful tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-1',
        toolName: 'read',
        output: { type: 'text' as const, value: 'file content' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(false)
    expect(blocks[0].output).toBe('file content')
  })

  it('sets isError=true for error-text tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-2',
        toolName: 'bash',
        output: { type: 'error-text' as const, value: 'Command not found' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(true)
    expect(blocks[0].output).toBe('Command not found')
  })

  it('sets isError=true for error-json tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-3',
        toolName: 'write',
        output: { type: 'error-json' as const, value: { code: 'ACCESS_DENIED' } },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(true)
  })

  it('preserves toolCallId and toolName', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-99',
        toolName: 'glob',
        output: { type: 'text' as const, value: 'results' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].toolCallId).toBe('call-99')
    expect(blocks[0].toolName).toBe('glob')
  })

  it('truncates large output', () => {
    const largeValue = 'x'.repeat(200 * 1024) // 200KB
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-big',
        toolName: 'read',
        output: { type: 'text' as const, value: largeValue },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].output.length).toBeLessThan(largeValue.length)
    expect(blocks[0].output).toContain('截断')
  })
})

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
})

describe('classifyLlmError — AbortError / timeout', () => {
  it('AbortError 分类为 LLM_TIMEOUT', () => {
    const err = new DOMException('signal timed out', 'TimeoutError')
    expect(classifyLlmError(err)).toBe('LLM_TIMEOUT')
  })

  it('普通 AbortError 分类为 LLM_TIMEOUT', () => {
    const err = new DOMException('The user aborted a request.', 'AbortError')
    expect(classifyLlmError(err)).toBe('LLM_TIMEOUT')
  })
})

describe('buildStreamSignal', () => {
  it('返回一个未中止的 AbortSignal', () => {
    const base = new AbortController()
    const signal = buildStreamSignal(base.signal)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('base signal 中止时，组合 signal 也中止', () => {
    const base = new AbortController()
    const signal = buildStreamSignal(base.signal)
    base.abort()
    expect(signal.aborted).toBe(true)
  })
})
