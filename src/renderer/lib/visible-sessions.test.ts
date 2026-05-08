// AC-016: visible session list must hide workbench (agent_id='__crystallizer__')
// sessions. The filter logic lives inline in pages/Chat/index.tsx; we extract
// the predicate here for unit testing.

import { describe, it, expect } from 'vitest'
import type { ChatSession } from '../types/chat'

function visibleSessionsOf(sessions: ChatSession[], showSubSessions: boolean): ChatSession[] {
  return sessions.filter(
    (s) => s.agent_id !== '__crystallizer__' && (showSubSessions || s.parent_session_id == null),
  )
}

function makeSession(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 's',
    title: 't',
    provider_id: 'p',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  } as ChatSession
}

describe('AC-016: visibleSessions filter', () => {
  it('hides agent_id=__crystallizer__ sessions even when showSubSessions=true', () => {
    const sessions = [
      makeSession({ id: 's1', agent_id: '__chat__' }),
      makeSession({ id: 'sw', agent_id: '__crystallizer__' }),
      makeSession({ id: 's2', agent_id: 'love-letter-writer' }),
    ]
    const visible = visibleSessionsOf(sessions, true)
    expect(visible.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('hides sub-sessions by default but shows top-level normal sessions', () => {
    const sessions = [
      makeSession({ id: 's1', agent_id: '__chat__', parent_session_id: undefined }),
      makeSession({ id: 'sub', agent_id: '__chat__', parent_session_id: 's1' }),
      makeSession({ id: 'sw', agent_id: '__crystallizer__' }),
    ]
    const visible = visibleSessionsOf(sessions, false)
    expect(visible.map((s) => s.id)).toEqual(['s1'])
  })

  it('keeps both crystallizer hidden when showSubSessions=true (does not override)', () => {
    const sessions = [
      makeSession({ id: 's1', agent_id: '__chat__' }),
      makeSession({ id: 'sw', agent_id: '__crystallizer__' }),
      makeSession({ id: 'sub', agent_id: '__chat__', parent_session_id: 's1' }),
    ]
    const visible = visibleSessionsOf(sessions, true)
    expect(visible.map((s) => s.id).sort()).toEqual(['s1', 'sub'])
  })
})
