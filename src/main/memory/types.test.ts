import { describe, it, expect } from 'vitest'
import { estimate, estimateMessage } from './types'
import type { ChatMessage } from '../repos/session-repo'

function makeMsg(content: object): ChatMessage {
  return {
    id: 'test',
    session_id: 's1',
    role: 'user',
    content: JSON.stringify(content),
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('estimate', () => {
  it('estimates English text at ~4 chars per token', () => {
    // 400 chars of English → ~100 tokens
    const english = 'a'.repeat(400)
    const tokens = estimate(english)
    expect(tokens).toBeGreaterThanOrEqual(80)
    expect(tokens).toBeLessThanOrEqual(120)
  })

  it('estimates Chinese text at ~1.5 chars per token', () => {
    // 150 Chinese chars → ~100 tokens
    const chinese = '中'.repeat(150)
    const tokens = estimate(chinese)
    expect(tokens).toBeGreaterThanOrEqual(80)
    expect(tokens).toBeLessThanOrEqual(130)
  })

  it('Chinese text estimates more tokens than same-length English', () => {
    const sameLength = 'a'.repeat(100)
    const chinese = '中'.repeat(100)
    expect(estimate(chinese)).toBeGreaterThan(estimate(sameLength))
  })
})

describe('estimateMessage', () => {
  it('includes tool result text in estimate', () => {
    const msg = makeMsg([{ type: 'tool_result', toolCallId: 'c1', toolName: 'read', output: 'a'.repeat(400), isError: false }])
    expect(estimateMessage(msg)).toBeGreaterThan(50)
  })

  it('adds fixed cost for images', () => {
    const withImage = makeMsg([{ type: 'image', image: 'data:...', mimeType: 'image/png' }])
    const withoutImage = makeMsg([{ type: 'text', text: '' }])
    expect(estimateMessage(withImage)).toBeGreaterThan(estimateMessage(withoutImage))
  })
})
