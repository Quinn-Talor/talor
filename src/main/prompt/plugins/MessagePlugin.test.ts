import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessagePlugin } from './MessagePlugin'
import type { PipelineContext } from '../types'
import type { Provider } from '../../store/config-store'
import type { ChatMessage } from '../../repos/session-repo'

vi.mock('../../repos/session-repo', () => ({
  messageRepo: { listBySession: vi.fn() },
}))

vi.mock('electron-log', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { messageRepo } from '../../repos/session-repo'

function makeMsg(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id,
    session_id: 's1',
    role,
    content,
    created_at: `2026-04-29T00:00:00.${id.padStart(3, '0')}Z`,
  }
}

function makeCtx(): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as Provider,
    providerConfig: {
      provider: { id: 'p1' } as Provider,
      context_limit: 8000, recent_ratio: 0.05, summary_ratio: 0.05,
    },
    workspacePath: undefined,
  }
}

describe('MessagePlugin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('空 session 返回空消息', async () => {
    vi.mocked(messageRepo.listBySession).mockReturnValue([])
    const result = await new MessagePlugin().build(makeCtx())
    expect(result.messages).toEqual([])
    expect(result.tokenEstimate).toBe(0)
  })

  it('末尾是 user 消息,正确注入', async () => {
    const msgs = [
      makeMsg('m1', 'user', JSON.stringify([{ type: 'text', text: '之前的问题' }])),
      makeMsg('m2', 'assistant', JSON.stringify([{ type: 'text', text: '之前的回答' }])),
      makeMsg('m3', 'user', JSON.stringify([{ type: 'text', text: '当前问题' }])),
    ]
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const result = await new MessagePlugin().build(makeCtx())
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('user')
  })

  it('末尾是 assistant(tool_use) 消息,正确注入', async () => {
    const msgs = [
      makeMsg('m1', 'user', JSON.stringify([{ type: 'text', text: '查一下' }])),
      makeMsg('m2', 'assistant', JSON.stringify([
        { type: 'tool_use', toolCallId: 'tc1', toolName: 'bash', input: { command: 'ls' } },
      ])),
    ]
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const result = await new MessagePlugin().build(makeCtx())
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('assistant')
  })

  it('末尾是 tool(result) 消息,正确注入', async () => {
    const msgs = [
      makeMsg('m1', 'user', JSON.stringify([{ type: 'text', text: '跑 ls' }])),
      makeMsg('m2', 'assistant', JSON.stringify([
        { type: 'tool_use', toolCallId: 'tc1', toolName: 'bash', input: { command: 'ls' } },
      ])),
      makeMsg('m3', 'tool', JSON.stringify([
        { type: 'tool_result', toolCallId: 'tc1', toolName: 'bash', output: 'file1\nfile2', isError: false },
      ])),
    ]
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const result = await new MessagePlugin().build(makeCtx())
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('tool')
  })

  it('只有 1 条消息时也正常注入', async () => {
    const msgs = [
      makeMsg('m1', 'user', JSON.stringify([{ type: 'text', text: 'first question' }])),
    ]
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const result = await new MessagePlugin().build(makeCtx())
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('user')
    expect(result.tokenEstimate).toBeGreaterThan(0)
  })
})
