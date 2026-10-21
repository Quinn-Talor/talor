import { describe, it, expect } from 'vitest'
import {
  countPersistedUserMessages,
  friendlyChatError,
  isHiddenChatMessage,
  isImeComposing,
  pickDefaultSession,
} from './chat-helpers'
import type { ChatMessage, ChatSession } from '../../types/chat'

function session(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 's',
    title: 't',
    provider_id: 'p',
    created_at: '2026-10-21T00:00:00.000Z',
    updated_at: '2026-10-21T00:00:00.000Z',
    ...overrides,
  }
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'm', session_id: 's', role: 'user', content: 'x', created_at: '', ...overrides }
}

describe('pickDefaultSession', () => {
  it('skips the crystallizer workbench and sub-sessions even when they are most recent', () => {
    const picked = pickDefaultSession([
      session({ id: 'wb', agent_id: '__crystallizer__' }),
      session({ id: 'child', parent_session_id: 'top' }),
      session({ id: 'top', agent_id: '__chat__' }),
    ])
    expect(picked?.id).toBe('top')
  })

  it('picks the first session when it is an ordinary top-level session', () => {
    expect(pickDefaultSession([session({ id: 'a' }), session({ id: 'b' })])?.id).toBe('a')
  })

  it('returns undefined when only hidden sessions exist', () => {
    expect(pickDefaultSession([session({ id: 'wb', agent_id: '__crystallizer__' })])).toBe(
      undefined,
    )
  })
})

describe('friendlyChatError', () => {
  it('maps attachment validation codes to Chinese hints', () => {
    expect(friendlyChatError('FILE_TOO_LARGE')).toContain('50MB')
    expect(friendlyChatError('PROVIDER_NO_VISION')).toBe('当前模型不支持图片识别')
  })

  it('returns null for unknown codes', () => {
    expect(friendlyChatError('SOMETHING_NEW')).toBeNull()
  })
})

describe('countPersistedUserMessages', () => {
  it('counts persisted user messages and ignores optimistic temp- messages', () => {
    expect(
      countPersistedUserMessages([
        message({ id: 'u1' }),
        message({ id: 'a1', role: 'assistant' }),
        message({ id: 'temp-123' }),
      ]),
    ).toBe(1)
  })
})

describe('isHiddenChatMessage', () => {
  it('hides persisted system nudges and tool messages', () => {
    expect(isHiddenChatMessage({ role: 'system' })).toBe(true)
    expect(isHiddenChatMessage({ role: 'tool' })).toBe(true)
  })

  it('shows user and assistant messages', () => {
    expect(isHiddenChatMessage({ role: 'user' })).toBe(false)
    expect(isHiddenChatMessage({ role: 'assistant' })).toBe(false)
  })
})

describe('isImeComposing', () => {
  it('treats Enter during IME composition as composing', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true }, keyCode: 13 })).toBe(true)
    expect(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 229 })).toBe(true)
  })

  it('treats a plain Enter as not composing', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false)
  })
})
