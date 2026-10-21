import { describe, it, expect } from 'vitest'
import { describeApprovalSource } from './pending-approvals'
import type { ChatSession } from '../types/chat'

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

const sessions = [
  session({ id: 's1', title: '主会话' }),
  session({ id: 's2', title: '另一个会话' }),
  session({ id: 'c1', title: '子任务', parent_session_id: 's1' }),
  session({ id: 'wb', title: 'wb', agent_id: '__crystallizer__' }),
]

describe('describeApprovalSource', () => {
  it('returns null for a request from the current session itself', () => {
    expect(describeApprovalSource('s1', 's1', 's1', sessions)).toBeNull()
  })

  it('labels sub-agent requests of the current turn', () => {
    expect(describeApprovalSource('c1', 's1', 's1', sessions)).toBe('来自 子 agent「子任务」')
  })

  it('labels requests from another session', () => {
    expect(describeApprovalSource('s2', 's2', 's1', sessions)).toBe('来自 会话「另一个会话」')
  })

  it('labels requests from the crystallizer workbench', () => {
    expect(describeApprovalSource('wb', 'wb', 's1', sessions)).toBe('来自 沉淀工作台')
  })
})
