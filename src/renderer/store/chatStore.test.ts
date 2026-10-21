import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, rootSessionOf } from './chatStore'
import type { ToolConfirmRequest } from '@shared/types/message'
import type { PermissionRequest } from '@shared/types/permissions'

const initial = useChatStore.getState()

function confirmReq(overrides: Partial<ToolConfirmRequest>): ToolConfirmRequest {
  return { sessionId: 's1', toolCallId: 'tc', toolName: 'bash', ...overrides }
}

function permissionReq(requestId: string): PermissionRequest {
  return {
    requestId,
    toolName: 'read',
    reason: 'path_outside_workspace',
    inputSummary: '/tmp/x',
    suggestedPatterns: [],
  }
}

beforeEach(() => {
  useChatStore.setState(initial, true)
})

describe('setCurrentSession', () => {
  it('selecting the already-current session keeps stream items and attachments', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.beginTurn('s1')
    s.appendStreamText(0, 'hi')
    s.addAttachment({ path: '/a', mime_type: 'text/plain', filename: 'a', size_bytes: 1 })

    useChatStore.getState().setCurrentSession('s1')

    const after = useChatStore.getState()
    expect(after.streamState).toBe('streaming')
    expect(after.streamItems).toHaveLength(1)
    expect(after.attachments).toHaveLength(1)
  })

  it('switching to a different session resets stream view and attachments', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.appendStreamText(0, 'hi')
    s.addAttachment({ path: '/a', mime_type: 'text/plain', filename: 'a', size_bytes: 1 })

    useChatStore.getState().setCurrentSession('s2')

    const after = useChatStore.getState()
    expect(after.streamState).toBe('idle')
    expect(after.streamItems).toEqual([])
    expect(after.attachments).toEqual([])
  })

  it('switching back to a session with a running turn shows it as streaming', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.beginTurn('s1')
    s.setCurrentSession('s2')
    expect(useChatStore.getState().streamState).toBe('idle')

    useChatStore.getState().setCurrentSession('s1')
    expect(useChatStore.getState().streamState).toBe('streaming')
  })
})

describe('turn lifecycle', () => {
  it('beginTurn enters streaming immediately for the current session', () => {
    useChatStore.getState().setCurrentSession('s1')
    useChatStore.getState().beginTurn('s1')
    expect(useChatStore.getState().streamState).toBe('streaming')
    expect(useChatStore.getState().turns.s1).toEqual({ messageId: null, stopped: false })
  })

  it('beginTurn for a non-current session (workbench) leaves the current view untouched', () => {
    useChatStore.getState().setCurrentSession('s1')
    useChatStore.getState().beginTurn('wb')
    expect(useChatStore.getState().streamState).toBe('idle')
    expect(useChatStore.getState().turns.wb).toBeDefined()
  })

  it('claimTurnEvent locks the first message id and rejects events of another turn', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.beginTurn('s1')
    expect(useChatStore.getState().claimTurnEvent('s1', 'm1')).toBe(true)
    expect(useChatStore.getState().turns.s1.messageId).toBe('m1')
    expect(useChatStore.getState().claimTurnEvent('s1', 'm1')).toBe(true)
    expect(useChatStore.getState().claimTurnEvent('s1', 'm0')).toBe(false)
  })

  it('claimTurnEvent accepts events when no turn is tracked for the session', () => {
    expect(useChatStore.getState().claimTurnEvent('s1', 'm1')).toBe(true)
  })

  it('claimTurnEvent drops every event of a stopped turn', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.beginTurn('s1')
    s.stopTurn('s1')
    expect(useChatStore.getState().streamState).toBe('idle')
    expect(useChatStore.getState().claimTurnEvent('s1', 'm1')).toBe(false)
  })

  it('commitStreaming ignores a done event from a different turn', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.beginTurn('s1')
    s.claimTurnEvent('s1', 'm2')
    s.appendStreamText(0, 'second')

    useChatStore.getState().commitStreaming('m1')
    expect(useChatStore.getState().streamState).toBe('streaming')
    expect(useChatStore.getState().streamItems).toHaveLength(1)

    useChatStore.getState().commitStreaming('m2')
    expect(useChatStore.getState().streamState).toBe('done')
    expect(useChatStore.getState().streamItems).toEqual([])
  })

  it('finishTurn settles a still-streaming view as done but keeps an error state', () => {
    const s = useChatStore.getState()
    s.setCurrentSession('s1')
    s.beginTurn('s1')
    useChatStore.getState().finishTurn('s1')
    expect(useChatStore.getState().streamState).toBe('done')
    expect(useChatStore.getState().turns.s1).toBeUndefined()

    useChatStore.getState().beginTurn('s1')
    useChatStore.getState().setStreamState('error')
    useChatStore.getState().finishTurn('s1')
    expect(useChatStore.getState().streamState).toBe('error')
  })
})

describe('tool confirm queue', () => {
  it('parallel confirms queue up instead of overwriting each other', () => {
    const s = useChatStore.getState()
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'a' }))
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'b' }))
    expect(useChatStore.getState().toolConfirmQueue.map((r) => r.toolCallId)).toEqual(['a', 'b'])

    useChatStore.getState().removeToolConfirm('a')
    expect(useChatStore.getState().toolConfirmQueue.map((r) => r.toolCallId)).toEqual(['b'])
  })

  it('a re-delivered request with the same toolCallId is not duplicated', () => {
    const s = useChatStore.getState()
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'a' }))
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'a' }))
    expect(useChatStore.getState().toolConfirmQueue).toHaveLength(1)
  })

  it('takeToolConfirmsForRoot takes the turn and its sub-agent requests, leaves other sessions', () => {
    const s = useChatStore.getState()
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'root', sessionId: 's1', rootSessionId: 's1' }))
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'child', sessionId: 'c1', rootSessionId: 's1' }))
    s.enqueueToolConfirm(confirmReq({ toolCallId: 'other', sessionId: 's2', rootSessionId: 's2' }))

    const taken = useChatStore.getState().takeToolConfirmsForRoot('s1')
    expect(taken.map((r) => r.toolCallId)).toEqual(['root', 'child'])
    expect(useChatStore.getState().toolConfirmQueue.map((r) => r.toolCallId)).toEqual(['other'])
  })

  it('rootSessionOf falls back to sessionId when rootSessionId is absent', () => {
    expect(rootSessionOf(confirmReq({ sessionId: 's9' }))).toBe('s9')
    expect(rootSessionOf(confirmReq({ sessionId: 'c1', rootSessionId: 's1' }))).toBe('s1')
  })
})

describe('permission queue', () => {
  it('queues concurrent permission requests and removes them by requestId', () => {
    const s = useChatStore.getState()
    s.enqueuePermission(permissionReq('p1'))
    s.enqueuePermission(permissionReq('p2'))
    s.enqueuePermission(permissionReq('p1'))
    expect(useChatStore.getState().permissionQueue.map((r) => r.requestId)).toEqual(['p1', 'p2'])

    useChatStore.getState().removePermission('p1')
    expect(useChatStore.getState().permissionQueue.map((r) => r.requestId)).toEqual(['p2'])
  })

  it('takePermissionsForRoot takes only the stopped turn requests', () => {
    useChatStore.setState({ permissionQueue: [] })
    const s = useChatStore.getState()
    s.enqueuePermission({ ...permissionReq('a'), rootSessionId: 's1' })
    s.enqueuePermission({ ...permissionReq('b'), rootSessionId: 's2' })
    const taken = useChatStore.getState().takePermissionsForRoot('s1')
    expect(taken.map((r) => r.requestId)).toEqual(['a'])
    expect(useChatStore.getState().permissionQueue.map((r) => r.requestId)).toEqual(['b'])
  })
})
