// src/renderer/invest/ProcessPanel.tsx —— 分析过程(自渲染研究会话 + composer)
//
// 对齐 demo 的 .convo:AI 怎么读/想/被怼时怎么答。轮次用 desk 风格气泡(.turn/.bub/.av),
// 底部 composer(问它… + 报/问/拨/挑 chips)。取选中卡建卡根会话消息(session:getMessages)。
// 注:live 发送(chat:send 往研究 agent 打)为后续接线;此处 composer UI 先就位。

import { useEffect, useState } from 'react'
import type { ChatMessage } from '../types/chat'

export function ProcessPanel({
  sessionId,
  stockName,
}: {
  sessionId: string | null
  stockName: string | null
}) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setMsgs([])
      return
    }
    let alive = true
    setMsgs(null)
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
  }, [sessionId])

  return (
    <section className="convo">
      <div className="convo-h">
        <div className="t">分析过程</div>
        <div className="s">AI 怎么读 / 怎么想 / 被你怼时怎么答 — 价值在这</div>
      </div>

      <div className="thread">
        {msgs == null && <div className="frozen">载入研究过程…</div>}
        {msgs != null && msgs.length === 0 && (
          <div className="frozen">
            {sessionId ? '此标的暂无研究对话' : '选一个标的看它的研究过程'}
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
      </div>

      <div className="composer">
        <div className="cin">
          <svg className="iv-ico" viewBox="0 0 24 24" style={{ color: 'var(--ink-3)' }}>
            <path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5A8 8 0 1 1 21 11.5z" />
          </svg>
          <input placeholder={stockName ? `问 ${stockName}…` : '问它…'} disabled={!sessionId} />
        </div>
        <div className="cchips">
          <span className="mut" style={{ fontSize: 9.5 }}>
            或
          </span>
          <button className="cchip">拨·改假设</button>
          <button className="cchip">挑·让它唱空</button>
        </div>
      </div>
    </section>
  )
}
