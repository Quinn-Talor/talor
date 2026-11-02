import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendPermissionResponse } = vi.hoisted(() => ({ sendPermissionResponse: vi.fn() }))

vi.mock('../api/talorAPI', () => ({ talorAPI: { chat: { sendPermissionResponse } } }))

import type { PermissionRequest } from '@shared/types/permissions'
import type { ToolConfirmRequest } from '@shared/types/message'
import { useChatStore } from '../store/chatStore'
import { settleTurnApprovals } from './usePendingApprovals'

const permission = (requestId: string, rootSessionId: string): PermissionRequest => ({
  requestId,
  toolName: 'write',
  reason: 'high_risk_tool',
  inputSummary: 'write a.txt',
  suggestedPatterns: [],
  rootSessionId,
})

const confirm = (toolCallId: string, sessionId: string): ToolConfirmRequest => ({
  sessionId,
  toolCallId,
  toolName: 'bash',
})

describe('settleTurnApprovals', () => {
  beforeEach(() => {
    sendPermissionResponse.mockClear()
    useChatStore.setState({ toolConfirmQueue: [], permissionQueue: [] })
  })

  it('AC-014 takes the finished turn requests and rejects its permission requests', () => {
    const s = useChatStore.getState()
    s.enqueueToolConfirm(confirm('t1', 's1'))
    s.enqueuePermission(permission('p1', 's1'))
    s.enqueuePermission(permission('p2', 's1'))
    s.enqueuePermission(permission('p3', 's2'))

    settleTurnApprovals('s1')

    const after = useChatStore.getState()
    expect(after.toolConfirmQueue).toEqual([])
    expect(after.permissionQueue.map((r) => r.requestId)).toEqual(['p3'])
    expect(sendPermissionResponse.mock.calls.map((c) => c[0])).toEqual([
      { requestId: 'p1', decision: 'rejected' },
      { requestId: 'p2', decision: 'rejected' },
    ])
  })

  it('AC-014 does nothing for a session with no pending requests', () => {
    useChatStore.getState().enqueuePermission(permission('p3', 's2'))
    settleTurnApprovals('s1')
    expect(useChatStore.getState().permissionQueue).toHaveLength(1)
    expect(sendPermissionResponse).not.toHaveBeenCalled()
  })
})
