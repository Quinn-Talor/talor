// @vitest-environment happy-dom
// U4:分析过程自渲染会话。mock session.getMessages,断言复用 MessageBubble 渲染消息 + 空态。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ProcessPanel } from './ProcessPanel'
import type { ChatMessage } from '../types/chat'

const msgs: ChatMessage[] = [
  { id: 'm1', session_id: 's1', role: 'user', content: '帮我研究比亚迪', created_at: '2026-03-01' },
  {
    id: 'm2',
    session_id: 's1',
    role: 'assistant',
    content: '先看行业渗透率与份额',
    created_at: '2026-03-01',
  },
]

function stubMessages(list: ChatMessage[]) {
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    session: { getMessages: vi.fn().mockResolvedValue(list) },
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('ProcessPanel(分析过程:自渲染研究会话)', () => {
  it('渲染会话消息(复用 MessageBubble)', async () => {
    stubMessages(msgs)
    render(<ProcessPanel sessionId="s1" />)
    expect(await screen.findByText('帮我研究比亚迪')).toBeTruthy()
    expect(screen.getByText('先看行业渗透率与份额')).toBeTruthy()
  })

  it('空会话 → 提示,不崩', async () => {
    stubMessages([])
    render(<ProcessPanel sessionId="s1" />)
    expect(await screen.findByText('此标的暂无研究对话')).toBeTruthy()
  })
})
