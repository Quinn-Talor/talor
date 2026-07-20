// @vitest-environment happy-dom
// 分析过程(demo .turn/.bub)+ 可对话 composer:渲染消息 / 空态 / 回车发送(chat.send)。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, configure } from '@testing-library/react'
import { ProcessPanel } from './ProcessPanel'
import type { ChatMessage } from '../types/chat'

configure({ asyncUtilTimeout: 3000 })

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

function stubAPI(list: ChatMessage[], send = vi.fn().mockResolvedValue({ message_id: 'x' })) {
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    session: { getMessages: vi.fn().mockResolvedValue(list) },
    chat: { send, onMessagePersisted: () => () => {} },
  }
  return send
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('ProcessPanel(分析过程:自渲染会话 + 可对话)', () => {
  it('渲染会话消息(desk 气泡)', async () => {
    stubAPI(msgs)
    render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    expect(await screen.findByText('帮我研究比亚迪')).toBeTruthy()
    expect(screen.getByText('先看行业渗透率与份额')).toBeTruthy()
  })

  it('空会话 → 提示,不崩', async () => {
    stubAPI([])
    render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    expect(await screen.findByText(/此标的暂无研究对话/)).toBeTruthy()
  })

  it('输入回车 → chat.send(卡片会话) + 清空', async () => {
    const send = stubAPI([])
    const { container } = render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    const input = container.querySelector('.cin input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '你是空方，分析比亚迪' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledWith({ session_id: 's1', content: '你是空方，分析比亚迪' })
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('拨/挑 chip → 预填输入框(不直接发送)', async () => {
    const send = stubAPI([])
    render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    fireEvent.click(screen.getByText('挑·让它唱空'))
    const input = document.querySelector('.cin input') as HTMLInputElement
    await waitFor(() => expect(input.value).toContain('唱空比亚迪'))
    expect(send).not.toHaveBeenCalled() // chip 只预填,不发送
  })
})
