// @vitest-environment happy-dom
// 分析过程(demo .turn/.bub)+ 可对话 composer:渲染消息 / 空态 / 回车发送(chat.send)。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, configure } from '@testing-library/react'
import { ProcessPanel } from './ProcessPanel'
import { useChatStore } from '../store/chatStore'
import type { ChatMessage } from '../types/chat'

configure({ asyncUtilTimeout: 3000 })

// 真实存储形态:user = JSON 字符串(带引号);assistant = block 数组,text 里是富 markdown。
// 面板须解码 + 渲染 markdown,而非直吐原始串(直吐即之前用户看到的"渲染很奇怪")。
const msgs: ChatMessage[] = [
  {
    id: 'm1',
    session_id: 's1',
    role: 'user',
    content: '"帮我研究比亚迪"',
    created_at: '2026-03-01',
  },
  {
    id: 'm2',
    session_id: 's1',
    role: 'assistant',
    content: '[{"type":"text","text":"## 结论\\n**看多**比亚迪，先看行业渗透率与份额。"}]',
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
  useChatStore.getState().setStreamState('idle')
  useChatStore.getState().setError(null)
})

describe('ProcessPanel(分析过程:自渲染会话 + 可对话)', () => {
  it('渲染会话消息:解码 JSON block 串 + 渲 markdown(不吐原始 JSON/记号)', async () => {
    stubAPI(msgs)
    const { container } = render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    // user:JSON 字符串解码后去引号
    expect(await screen.findByText('帮我研究比亚迪')).toBeTruthy()
    // assistant:markdown 结构化(## → h2,** → strong),文本落在其中
    await waitFor(() =>
      expect(container.querySelector('.prose-talor h2')?.textContent).toContain('结论'),
    )
    expect(container.querySelector('.prose-talor strong')?.textContent).toContain('看多')
    // 关键回归:不再出现 JSON 包裹串,也不再出现未渲染的 markdown 记号
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('[{"type"')
    expect(txt).not.toContain('**')
    expect(txt).not.toContain('## ')
    expect(txt).not.toContain('"帮我研究比亚迪"') // user 引号已去
  })

  it('assistant 含 tool_use 块 → 只渲文本,工具块被丢弃', async () => {
    stubAPI([
      {
        id: 'm3',
        session_id: 's1',
        role: 'assistant',
        content:
          '[{"type":"text","text":"正在估值"},{"type":"tool_use","name":"compute_valuation","input":{}}]',
        created_at: '2026-03-02',
      },
    ])
    const { container } = render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    await waitFor(() => expect(container.textContent ?? '').toContain('正在估值'))
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('compute_valuation')
    expect(txt).not.toContain('tool_use')
    expect(txt).not.toContain('[{"type"')
  })

  it('(兜底)content 为纯文本(非 JSON)→ 原样渲染,不崩', async () => {
    stubAPI([
      {
        id: 'm4',
        session_id: 's1',
        role: 'assistant',
        content: '先看渗透率与份额',
        created_at: '2026-03-03',
      },
    ])
    const { container } = render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    await waitFor(() => expect(container.textContent ?? '').toContain('先看渗透率与份额'))
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

  it('研究轮出错 → 展示错误行(不静默)', async () => {
    stubAPI([])
    useChatStore.getState().setError({ code: 'X', message: '模型不可用' })
    useChatStore.getState().setStreamState('error')
    const { container } = render(<ProcessPanel sessionId="s1" stockName="比亚迪" />)
    await waitFor(() => expect(container.textContent ?? '').toContain('研究出错:模型不可用'))
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
