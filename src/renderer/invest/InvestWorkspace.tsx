// src/renderer/invest/InvestWorkspace.tsx —— 投研工作台(平台顶级 surface,B-ii 专属视觉)
//
// 布局对齐 demo:头部 + 三区(池子 | 画布[时光机+活论文] | 分析过程)+ 图例。
// 视觉走 invest.css 的 .invest-surface 设计系统(light-first + 暗色适配,与 Talor token 隔离)。
// U2 池子接真数据(artifact:list);选中态上提给 ActivePaper / ProcessPanel。

import { useEffect, useState } from 'react'
import type { CardSummary, Validity } from '@shared/types/invest'
import { ActivePaper } from './ActivePaper'
import { ProcessPanel } from './ProcessPanel'
import { useStreamingMessage } from '../hooks/useStreamingMessage'
import { useChatStore } from '../store/chatStore'
import { PermissionsPopover } from '../components/PermissionsPopover'
import './invest.css'

interface InvestWorkspaceProps {
  onBack: () => void
}

/** 健康点色:证伪=红,校准=琥珀,强化/持有=绿,无复查=灰。 */
function sdotColor(validity?: Validity): string {
  if (validity === '证伪') return 'var(--bad)'
  if (validity === '校准') return 'var(--warn)'
  if (validity === '强化' || validity === '持有') return 'var(--good)'
  return 'var(--ink-3)'
}

export function InvestWorkspace({ onBack }: InvestWorkspaceProps) {
  const [cards, setCards] = useState<CardSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tick, setTick] = useState(0) // 落库/建卡 → bump,驱动 池子/活论文/对话 刷新

  // 池子:挂载 + 每次 tick 重取(setSelectedId(prev??) 保留当前选中)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = (await window.talorAPI.artifact.list('stock_card')) as CardSummary[]
        if (!alive) return
        setCards(list ?? [])
        setSelectedId((prev) => prev ?? list?.[0]?.id ?? null)
      } catch {
        // 无 preload 桥(浏览器直测 / 测试未 mock)→ 空池,不崩
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [tick])

  const selected = cards.find((c) => c.id === selectedId) ?? null
  const activeSession = selected?.origin_session_id ?? null

  // 选卡即确保其研究会话存在(修悬空 origin_session → 发消息违反 chat 外键;同 id 重建 + 绑研究 agent)
  useEffect(() => {
    if (!selectedId) return
    try {
      void window.talorAPI.invest.ensureSession(selectedId)
    } catch {
      /* 测试/无桥:忽略 */
    }
  }, [selectedId])

  // A2:把平台流式引擎挂到选中卡的根会话(chat 页此时未挂载 → 单会话 chatStore 无并发)
  useStreamingMessage(activeSession)

  // 落库事件:清掉已落库步的流式项(防重影)+ bump tick(刷新三区,反映 agent 更新卡)
  useEffect(() => {
    if (!activeSession) return
    let unsub: (() => void) | undefined
    try {
      unsub = window.talorAPI.chat.onMessagePersisted((ev) => {
        if (ev.session_id !== activeSession) return
        useChatStore.getState().dropStreamItemsUpToStep(ev.step_index)
        setTick((t) => t + 1)
      })
    } catch {
      /* 测试/无桥:忽略 */
    }
    return () => unsub?.()
  }, [activeSession])

  return (
    <div className="invest-surface">
      {/* 头部 */}
      <header className="iv-head">
        <div className="iv-title">
          <b>投研工作台</b> · Research Desk{selected ? ' · ' + selected.name : ''}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 工具确认/权限:研究轮触发时在此弹(chat 页此时未挂载,由工作台兜) */}
          <PermissionsPopover workspacePath="" />
          <button className="iv-back" onClick={onBack}>
            ← 返回对话
          </button>
        </div>
      </header>

      {/* 三区 */}
      <div className="iv-body">
        {/* 池子 */}
        <aside className="pool">
          <h4>我的论文 · {cards.length}</h4>
          {cards.length === 0 ? (
            <div className="iv-empty" style={{ height: 'auto', paddingTop: 24 }}>
              {loaded ? '暂无标的' : '载入中…'}
            </div>
          ) : (
            cards.map((c) => (
              <button
                key={c.id}
                className={'thumb' + (c.id === selectedId ? ' active' : '')}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="tn">
                  <span className="tcode">{c.code}</span>
                  {c.name}
                  <span className="sdot" style={{ background: sdotColor(c.validity) }} />
                </div>
                <div className="tc">
                  {c.claim ?? (c.validity ? `最新:${c.validity}` : '待建立逻辑')}
                </div>
              </button>
            ))
          )}
        </aside>

        {/* 画布:时光机 + 活论文 */}
        {selectedId ? (
          <ActivePaper cardId={selectedId} refreshTick={tick} />
        ) : (
          <main className="canvas">
            <div className="iv-empty">选一个标的，展开它的活论文</div>
          </main>
        )}

        {/* 分析过程 */}
        <ProcessPanel
          sessionId={activeSession}
          stockName={selected?.name ?? null}
          refreshTick={tick}
        />
      </div>

      {/* 图例 */}
      <div className="legend">
        <span className="lg">
          <span className="nd n-build" style={{ width: 9, height: 9 }} />
          建立
        </span>
        <span className="lg">
          <span className="nd n-ver" style={{ width: 9, height: 9 }} />
          校准·出新版
        </span>
        <span className="lg">
          <span className="nd n-hold" style={{ width: 9, height: 9 }} />
          复查·持有
        </span>
        <span className="lg">
          <span className="nd n-warn" style={{ width: 9, height: 9 }} />
          复查·异动
        </span>
        <span className="lg">
          <span className="nd n-dec" style={{ width: 9, height: 9 }} />
          决策
        </span>
        <span className="mut">｜ 脊梁=逻辑版本</span>
      </div>
    </div>
  )
}
