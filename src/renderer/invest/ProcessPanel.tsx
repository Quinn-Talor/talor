// src/renderer/invest/ProcessPanel.tsx —— 分析过程(自渲染研究会话 + 可对话 composer)
//
// A1:composer 接 chat.send(卡片根会话);refreshTick(由 InvestWorkspace 在 message-persisted
//     时 bump)→ 重取消息。A2:实时流式复用 chatStore(InvestWorkspace 挂 useStreamingMessage
//     + PermissionsPopover;此处只读 streamState/streamItems 渲染"研究中"活气泡)。
// 拨/挑 chip 预填模板到输入框。轮次的工具确认/权限由工作台的 PermissionsPopover 兜。

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { useChatStore } from '../store/chatStore'

export function ProcessPanel({
  sessionId,
  stockName,
  refreshTick,
}: {
  sessionId: string | null
  stockName: string | null
  refreshTick?: number
}) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const streamState = useChatStore((s) => s.streamState)
  const streamItems = useChatStore((s) => s.streamItems)
  const chatError = useChatStore((s) => s.error)
  const streaming = streamState === 'streaming'

  useEffect(() => {
    if (!sessionId) {
      setMsgs([])
      return
    }
    let alive = true
    ;(async () => {
      try {
        const m = await window.talorAPI.session.getMessages(sessionId)
        if (alive) setMsgs(m ?? [])
      } catch {
        if (alive) setMsgs([])
      }
    })()
    return () => {
      alive = false
    }
  }, [sessionId, refreshTick])

  const send = (text: string) => {
    const content = text.trim()
    if (!content || !sessionId || streaming) return
    setInput('')
    // 发给卡片根会话的研究 agent;落库事件驱动 refreshTick → 重取消息,流式经 chatStore 实时显
    window.talorAPI.chat.send({ session_id: sessionId, content }).catch(() => {})
  }

  const prefill = (t: string) => {
    setInput(t)
    inputRef.current?.focus()
  }

  // 流式活气泡:把 streamItems 聚成文本 + 工具行(类型收窄走循环,免 StreamItem 导入)
  let liveText = ''
  const liveTools: { name: string; status: string }[] = []
  for (const it of streamItems) {
    if (it.type === 'text') liveText += it.content
    else liveTools.push({ name: it.entry.toolName, status: it.entry.status })
  }

  return (
    <section className="convo">
      <div className="convo-h">
        <div className="t">分析过程</div>
        <div className="s">AI 怎么读 / 怎么想 / 被你怼时怎么答 — 价值在这</div>
      </div>

      <div className="thread">
        {msgs == null && <div className="frozen">载入研究过程…</div>}
        {msgs != null && msgs.length === 0 && !streaming && (
          <div className="frozen">
            {sessionId ? '此标的暂无研究对话 —— 问它,或让它唱空' : '选一个标的看它的研究过程'}
          </div>
        )}
        {msgs?.map((m) => {
          const you = m.role === 'user'
          return (
            <div className={'turn' + (you ? ' you' : '')} key={m.id}>
              <div className={'av ' + (you ? 'you' : 'ai')}>{you ? '你' : 'AI'}</div>
              <div className="bub">
                {m.created_at && <span className="tt">{m.created_at.slice(0, 10)}</span>}
                {m.content}
              </div>
            </div>
          )
        })}
        {streaming && (
          <div className="turn">
            <div className="av ai">AI</div>
            <div className="bub">
              {liveText}
              {liveTools.map((t, i) => (
                <div key={i} style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 3 }}>
                  · 调用 {t.name} {t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'}
                </div>
              ))}
              <span style={{ color: 'var(--accent)' }}>▋</span>
            </div>
          </div>
        )}
        {streamState === 'error' && chatError && (
          <div className="turn">
            <div className="av ai">AI</div>
            <div className="bub" style={{ color: 'var(--bad)' }}>
              研究出错:{chatError.message || chatError.code} · 可重发
            </div>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="cin">
          <svg className="iv-ico" viewBox="0 0 24 24" style={{ color: 'var(--ink-3)' }}>
            <path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5A8 8 0 1 1 21 11.5z" />
          </svg>
          <input
            ref={inputRef}
            value={input}
            placeholder={streaming ? 'AI 研究中…' : stockName ? `问 ${stockName}…` : '问它…'}
            disabled={!sessionId || streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
          />
        </div>
        <div className="cchips">
          <span className="mut" style={{ fontSize: 9.5 }}>
            或
          </span>
          <button
            className="cchip"
            disabled={!sessionId || streaming}
            onClick={() => prefill(`帮我拨一下${stockName ?? '这只票'}的关键假设，看估值敏感度。`)}
          >
            拨·改假设
          </button>
          <button
            className="cchip"
            disabled={!sessionId || streaming}
            onClick={() =>
              prefill(
                `你是空方，唱空${stockName ?? '这只票'}：找出我论文里最脆弱的假设并尝试证伪。`,
              )
            }
          >
            挑·让它唱空
          </button>
        </div>
      </div>
    </section>
  )
}
