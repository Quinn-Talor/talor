// src/renderer/invest/InvestWorkspace.tsx —— 投研工作台(平台顶级 surface,B-ii 专属视觉)
//
// 布局对齐 demo:头部 + 三区(池子 | 画布[时光机+活论文] | 分析过程)+ 图例。
// 视觉走 invest.css 的 .invest-surface 设计系统(light-first + 暗色适配,与 Talor token 隔离)。
// U2 池子接真数据(artifact:list);选中态上提给 ActivePaper / ProcessPanel。

import { useEffect, useState } from 'react'
import type { CardSummary, Validity } from '@shared/types/invest'
import { ActivePaper } from './ActivePaper'
import { ProcessPanel } from './ProcessPanel'
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
  }, [])

  const selected = cards.find((c) => c.id === selectedId) ?? null

  return (
    <div className="invest-surface">
      {/* 头部 */}
      <header className="iv-head">
        <div className="iv-title">
          <b>投研工作台</b> · Research Desk{selected ? ' · ' + selected.name : ''}
        </div>
        <button className="iv-back" onClick={onBack}>
          ← 返回对话
        </button>
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
          <ActivePaper cardId={selectedId} />
        ) : (
          <main className="canvas">
            <div className="iv-empty">选一个标的，展开它的活论文</div>
          </main>
        )}

        {/* 分析过程 */}
        <ProcessPanel
          sessionId={selected?.origin_session_id ?? null}
          stockName={selected?.name ?? null}
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
