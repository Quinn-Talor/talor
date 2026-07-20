// src/renderer/invest/InvestWorkspace.tsx —— 投研工作台(平台顶级 surface,B-ii 专属视觉)
//
// 三区:池子 | 活论文 | 分析过程。与 chat/settings 视觉解耦,自带"研究台"深色底。
// U1 壳 → U2 池子接真数据(artifact:list('stock_card') → CardSummary[])+ 选中态上提
//   (供 U3 活论文 / U4 对话消费)。U3/U4 尚为占位,接选中卡后填。
// 视觉走自包含 bespoke tokens(挂根 style),不依赖 index.css 主题。

import { useEffect, useState, type CSSProperties } from 'react'
import type { CardSummary, CardStatus, Validity } from '@shared/types/invest'
import { ActivePaper } from './ActivePaper'
import { ProcessPanel } from './ProcessPanel'

/** 研究台 bespoke 调色板(自包含,不受平台明暗主题影响)。 */
const DESK: CSSProperties = {
  // @ts-expect-error CSS custom properties
  '--desk-bg': '#0f1216',
  '--desk-panel': '#161b22',
  '--desk-line': '#242c37',
  '--desk-ink': '#e6edf3',
  '--desk-mute': '#8b98a9',
  '--desk-subtle': '#5b6675',
  '--desk-accent': '#4a9eff',
}

interface InvestWorkspaceProps {
  onBack: () => void
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
    <div
      className="flex flex-col h-full w-full"
      style={{ ...DESK, background: 'var(--desk-bg)', color: 'var(--desk-ink)' }}
    >
      {/* 顶栏:身份 + 返回 */}
      <header
        className="flex items-center justify-between px-5 h-[52px] shrink-0"
        style={{ borderBottom: '1px solid var(--desk-line)' }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-[0.02em]">投研工作台</span>
          <span className="text-[11px]" style={{ color: 'var(--desk-subtle)' }}>
            Research Desk
          </span>
        </div>
        <button
          onClick={onBack}
          className="text-[12px] px-2.5 py-1 rounded-md transition-colors"
          style={{ color: 'var(--desk-mute)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--desk-panel)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          ← 返回对话
        </button>
      </header>

      {/* 三区:池子 | 活论文 | 分析过程 */}
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: '260px 1fr 380px' }}>
        <Zone title="池子" hint={`候选与在研 · ${cards.length}`} side>
          {cards.length === 0 ? (
            <Empty>{loaded ? '暂无标的 —— 建卡后在此归池' : '载入中…'}</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {cards.map((c) => (
                <PoolRow
                  key={c.id}
                  card={c}
                  active={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </ul>
          )}
        </Zone>

        <Zone title="活论文" hint="时光机 · 传导链 · 事实">
          {selectedId ? (
            <ActivePaper cardId={selectedId} />
          ) : (
            <Empty>选一个标的，展开它的活论文</Empty>
          )}
        </Zone>

        <Zone title="分析过程" hint="报 · 问 · 拨 · 挑" side last>
          {selected ? (
            <ProcessPanel sessionId={selected.origin_session_id} />
          ) : (
            <Empty>与研究 agent 的对话过程将出现在这里</Empty>
          )}
        </Zone>
      </div>
    </div>
  )
}

/** 池子一行:代码/名 + 状态点 + 当前逻辑一句话 + 赚钱型/有效性。 */
function PoolRow(props: { card: CardSummary; active: boolean; onClick: () => void }) {
  const { card, active, onClick } = props
  return (
    <li>
      <button
        onClick={onClick}
        className="w-full text-left rounded-lg px-2.5 py-2 transition-colors"
        style={{
          background: active ? 'var(--desk-bg)' : 'transparent',
          border: `1px solid ${active ? 'var(--desk-accent)' : 'var(--desk-line)'}`,
        }}
      >
        <div className="flex items-center gap-1.5">
          <StatusDot status={card.status} />
          <span className="font-mono text-[11px]" style={{ color: 'var(--desk-mute)' }}>
            {card.code}
          </span>
          <span className="text-[12.5px] font-medium truncate">{card.name}</span>
        </div>
        {card.claim && (
          <div
            className="text-[11px] mt-1 leading-snug line-clamp-2"
            style={{ color: 'var(--desk-mute)' }}
          >
            {card.claim}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1.5">
          {card.profit_type && <Chip>{card.profit_type}</Chip>}
          {card.validity && <ValidityChip validity={card.validity} />}
        </div>
      </button>
    </li>
  )
}

const STATUS_COLOR: Record<CardStatus, string> = {
  watching: '#8b98a9',
  held: '#3fb950',
  closed: '#5b6675',
}

function StatusDot({ status }: { status: CardStatus }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: STATUS_COLOR[status] }}
    />
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--desk-bg)', color: 'var(--desk-subtle)' }}
    >
      {children}
    </span>
  )
}

/** 有效性配色:证伪=红,校准=琥珀,强化/持有=绿。 */
const VALIDITY_COLOR: Record<Validity, string> = {
  强化: '#3fb950',
  持有: '#3fb950',
  校准: '#d29922',
  证伪: '#f85149',
}

function ValidityChip({ validity }: { validity: Validity }) {
  const color = VALIDITY_COLOR[validity]
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ background: `${color}1f`, color }}
    >
      {validity}
    </span>
  )
}

function Zone(props: {
  title: string
  hint: string
  side?: boolean
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className="flex flex-col min-h-0"
      style={{
        background: props.side ? 'var(--desk-panel)' : 'var(--desk-bg)',
        borderRight: props.last ? 'none' : '1px solid var(--desk-line)',
      }}
    >
      <div className="px-4 pt-3.5 pb-2 shrink-0">
        <div className="text-[13px] font-semibold">{props.title}</div>
        <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--desk-subtle)' }}>
          {props.hint}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 pb-4">{props.children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-full flex items-center justify-center text-center text-[12px] leading-relaxed px-3"
      style={{ color: 'var(--desk-subtle)' }}
    >
      {children}
    </div>
  )
}
