// src/renderer/invest/ProcessPanel.tsx —— 分析过程(自渲染研究会话,复用 MessageBubble)
//
// U4:工作台右栏。取选中卡的建卡根会话(origin_session_id)的消息,复用平台
// MessageBubble 渲染完整研究过程(报/问/拨/挑),不改核心 chat。
// MessageBubble 为浅色主题设计(app 仅浅色);desk 深色下用浅底 transcript 承载 → 可读。

import { useEffect, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { MessageBubble } from '../components/MessageBubble'

export function ProcessPanel({ sessionId }: { sessionId: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)

  useEffect(() => {
    let alive = true
    setMsgs(null)
    ;(async () => {
      try {
        const m = await window.talorAPI.session.getMessages(sessionId)
        if (alive) setMsgs(m ?? [])
      } catch {
        if (alive) setMsgs([]) // 无 preload 桥(浏览器/测试)→ 空,不崩
      }
    })()
    return () => {
      alive = false
    }
  }, [sessionId])

  if (msgs == null) return <Note>载入研究过程…</Note>
  if (msgs.length === 0) return <Note>此标的暂无研究对话</Note>

  return (
    <div
      className="rounded-lg overflow-auto h-full"
      style={{ background: 'var(--canvas)', color: 'var(--text)' }}
    >
      <div className="flex flex-col gap-1 p-3">
        {msgs.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11.5px] py-4 text-center" style={{ color: 'var(--desk-subtle)' }}>
      {children}
    </div>
  )
}
