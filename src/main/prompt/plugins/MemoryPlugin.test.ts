import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { listBySession } = vi.hoisted(() => ({ listBySession: vi.fn() }))
vi.mock('../../repos/session-repo', () => ({ messageRepo: { listBySession } }))
vi.mock('../../tools/tool-result-template', () => ({ buildToolResultGuide: () => 'guide' }))

import { MemoryPlugin } from './MemoryPlugin'
import type { MemoryManager } from '../../memory/MemoryManager'
import type { PipelineContext } from '../types'
import type { ChatMessage } from '../../repos/session-repo'
import type { Provider } from '../../store/config-store'

function msg(id: string, role: ChatMessage['role'], content: unknown[]): ChatMessage {
  return {
    id,
    session_id: 's1',
    role,
    content: JSON.stringify(content),
    agent_id: '__chat__',
    created_at: '',
  }
}
const text = (id: string, role: 'user' | 'assistant' = 'user') =>
  msg(id, role, [{ type: 'text', text: id }])
const toolResult = (id: string) =>
  msg(id, 'tool', [
    { type: 'tool-result', toolCallId: id, toolName: 'bash', output: { type: 'text', value: id } },
  ])

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as Provider,
    providerConfig: {
      provider: { id: 'p1' } as Provider,
      context_limit: 8000,
      recent_ratio: 0.05,
      summary_ratio: 0.1,
    },
    workspacePath: undefined,
    ...overrides,
  }
}

function failingManager(): MemoryManager {
  return {
    getContext: vi.fn().mockRejectedValue(new Error('db locked')),
  } as unknown as MemoryManager
}

/** 从 ModelMessage 里取出用于断言的文本 id。 */
function ids(messages: Array<{ content: unknown }>): string[] {
  return messages.map((m) => {
    const parts = m.content as Array<{ text?: string; toolCallId?: string }>
    return parts[0].text ?? parts[0].toolCallId ?? '?'
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MemoryPlugin', () => {
  it('把固定开销 / abortSignal / events 透传给 memoryManager', async () => {
    const getContext = vi.fn().mockResolvedValue({
      summaryMessage: null,
      recentMessages: [],
      tokenEstimate: 0,
    })
    const signal = new AbortController().signal
    await new MemoryPlugin({ getContext } as unknown as MemoryManager).build(
      ctx({ fixedOverheadTokens: 1234, abortSignal: signal }),
    )
    expect(getContext).toHaveBeenCalledWith(
      's1',
      expect.anything(),
      expect.objectContaining({ fixedOverheadTokens: 1234, abortSignal: signal }),
    )
  })

  it('降级路径不包含末条消息(由 MessagePlugin 注入,避免重复)', async () => {
    listBySession.mockReturnValue([text('u1'), text('a1', 'assistant'), text('u2-current')])
    const res = await new MemoryPlugin(failingManager()).build(ctx())
    expect(ids(res.messages)).toEqual(['u1', 'a1'])
  })

  it('降级窗口以孤立 tool 开头时去掉这些 tool', async () => {
    const history = [
      text('u0'),
      ...Array.from({ length: 2 }, (_, i) => toolResult(`t${i}`)),
      ...Array.from({ length: 19 }, (_, i) => text(`x${i}`)),
      text('current'),
    ]
    listBySession.mockReturnValue(history)
    const res = await new MemoryPlugin(failingManager()).build(ctx())
    // 去掉末条后最后 20 条为 [t1, x0..x18]:开头的 t1 失去 assistant(tool_use),被去掉
    expect(res.messages[0].role).not.toBe('tool')
    expect(ids(res.messages)).not.toContain('current')
    expect(res.messages).toHaveLength(19)
  })

  it('降级窗口开头不是 tool 时保持 20 条(不触发)', async () => {
    const history = [...Array.from({ length: 25 }, (_, i) => text(`x${i}`)), text('current')]
    listBySession.mockReturnValue(history)
    const res = await new MemoryPlugin(failingManager()).build(ctx())
    expect(res.messages).toHaveLength(20)
    expect(ids(res.messages)[19]).toBe('x24')
  })
})
