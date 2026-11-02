// chat:send 把引擎路径的推理流与运行状态转发给渲染端（C1 AC-006）。

import { describe, it, expect, vi } from 'vitest'

const { mockHandle, sent, dispatchTurn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  sent: [] as Array<[string, unknown]>,
  dispatchTurn: vi.fn(),
}))

vi.mock('electron', () => ({ ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) } }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./window', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) },
  }),
}))
vi.mock('./tool-confirm', () => ({ requestToolConfirm: vi.fn() }))
vi.mock('./permission', () => ({ requestPermissionFromRenderer: vi.fn() }))
vi.mock('../runtime/dispatch', () => ({ dispatchTurn }))

import type { AgentManager } from '../agent/agent-manager'
import type { ChatCallbacks } from '../chat/types'
import { registerChatHandlers } from './chat'

describe('chat:send engine events', () => {
  it('AC-006 forwards reasoning deltas and run status to the renderer', async () => {
    dispatchTurn.mockImplementation(async (_params: unknown, callbacks: ChatCallbacks) => {
      callbacks.onReasoningDelta?.('m1', '想', 2)
      callbacks.onRunStatus?.('m1', 'verifying')
      return { messageId: 'm1' }
    })
    registerChatHandlers({} as AgentManager)
    const handler = mockHandle.mock.calls.find((c) => c[0] === 'chat:send')![1] as (
      ...a: unknown[]
    ) => Promise<unknown>

    await expect(handler(null, { session_id: 's1', content: 'hi' })).resolves.toEqual({
      message_id: 'm1',
    })

    expect(sent).toEqual([
      ['chat:reasoning', { session_id: 's1', message_id: 'm1', delta: '想', step_index: 2 }],
      ['chat:status', { session_id: 's1', message_id: 'm1', status: 'verifying' }],
    ])
  })
})
