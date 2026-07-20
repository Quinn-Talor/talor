// src/renderer/invest/ActivePaper.tsx —— 活论文中栏(时光机 · 传导链 · 事实)
//
// U3b:消费 summarizeHealth 派生 + reconstructCardAt(U3a)。上中下:
//   上 时光机 —— 时间线节点轨(点节点 → 切到该 T,历史冻结只读)
//   中 传导链 —— 事实 → 逻辑 → 预期 → 估值 → 决策(对齐 DecisionSurface 链条)
//   下 事实 —— 命门/排雷事实 + 新鲜度
// 视觉走 desk bespoke tokens(var(--desk-*) 从 InvestWorkspace 根 cascade,无需重定义)。

import { useEffect, useMemo, useState } from 'react'
import type { CardBundle, Checkpoint, DecisionEvent } from '@shared/types/invest'
import {
  reconstructCardAt,
  timelineRows,
  coreLogicLines,
  valuationTrace,
  currentThesis,
  safety,
  factFreshness,
  type TimelineRow,
  type LogicLine,
} from './summarizeHealth'

const KIND_GLYPH: Record<TimelineRow['kind'], string> = {
  建立: '◆',
  复查: '●',
  决策: '▲',
  复盘: '◇',
}
const VALIDITY_COLOR: Record<string, string> = {
  强化: '#3fb950',
  持有: '#3fb950',
  校准: '#d29922',
  证伪: '#f85149',
}

export function ActivePaper({ cardId }: { cardId: string }) {
  const [bundle, setBundle] = useState<CardBundle | null>(null)
  const [pickedAt, setPickedAt] = useState<string | null>(null) // null = 现在(最新)

  useEffect(() => {
    let alive = true
    setPickedAt(null)
    ;(async () => {
      try {
        const b = (await window.talorAPI.artifact.read('stock_card', cardId)) as CardBundle | null
        if (alive) setBundle(b)
      } catch {
        if (alive) setBundle(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [cardId])

  const rows = useMemo(() => timelineRows(bundle), [bundle])
  const nowAt = rows[0]?.at ?? null // timelineRows 逆序,首行=最新
  const isNow = pickedAt == null
  const effectiveAt = pickedAt ?? nowAt // 仅供时光机高亮"现在"节点
  // 现在 = 全量 bundle(含最新逻辑版,可能晚于最后一个时间线节点);点历史节点才切片(冻结只读)
  const view = useMemo(
    () => (pickedAt && bundle ? reconstructCardAt(bundle, pickedAt) : bundle),
    [bundle, pickedAt],
  )

  if (!bundle) {
    return <Muted>载入案卷…</Muted>
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <TimeMachine rows={rows} effectiveAt={effectiveAt} isNow={isNow} onPick={setPickedAt} />
      <Chain view={view} frozen={!isNow} at={effectiveAt} />
      <FactsPanel view={view} />
    </div>
  )
}

// ═══ 上:时光机 ═══════════════════════════════════════════════
function TimeMachine(props: {
  rows: TimelineRow[]
  effectiveAt: string | null
  isNow: boolean
  onPick: (at: string | null) => void
}) {
  const { rows, effectiveAt, isNow, onPick } = props
  // 时间序(旧→新)展示,现在在最右
  const chrono = [...rows].reverse()
  return (
    <Section title="时光机" badge={isNow ? undefined : '历史 · 冻结只读'}>
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        {chrono.map((r, i) => {
          const active = r.at === effectiveAt
          const validity =
            r.kind === '复查' ? (r.event as Checkpoint | undefined)?.validity : undefined
          const color = validity ? VALIDITY_COLOR[validity] : 'var(--desk-mute)'
          return (
            <button
              key={`${r.at}-${r.kind}-${i}`}
              onClick={() => onPick(i === chrono.length - 1 ? null : r.at)}
              className="shrink-0 rounded-md px-2 py-1.5 text-left transition-colors"
              style={{
                minWidth: 78,
                background: active ? 'var(--desk-bg)' : 'transparent',
                border: `1px solid ${active ? 'var(--desk-accent)' : 'var(--desk-line)'}`,
              }}
              title={`${r.kind} · v${r.version}${validity ? ' · ' + validity : ''}`}
            >
              <div className="flex items-center gap-1">
                <span style={{ color, fontSize: 9 }}>{KIND_GLYPH[r.kind]}</span>
                <span className="text-[10px]" style={{ color: 'var(--desk-subtle)' }}>
                  v{r.version}
                </span>
              </div>
              <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--desk-ink)' }}>
                {r.kind}
              </div>
              <div className="text-[9.5px] font-mono" style={{ color: 'var(--desk-subtle)' }}>
                {r.at.slice(0, 10)}
              </div>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

// ═══ 中:传导链(事实→逻辑→预期→估值→决策)═════════════════════
function Chain(props: { view: CardBundle | null; frozen: boolean; at: string | null }) {
  const { view } = props
  const cur = currentThesis(view)
  const logic = useMemo(() => coreLogicLines(view), [view])
  const trace = useMemo(() => (cur ? valuationTrace(cur, view?.facts) : null), [cur, view])
  const sv = safety(view)
  const decision = useMemo(() => {
    for (let i = (view?.timeline.length ?? 0) - 1; i >= 0; i--) {
      const e = view!.timeline[i]
      if (e.type === '决策') return e as DecisionEvent
    }
    return null
  }, [view])

  if (!cur) {
    return (
      <Section title="传导链">
        <Muted>此时点尚无逻辑版本(建卡前 / 首版未立)</Muted>
      </Section>
    )
  }

  return (
    <Section title="传导链" badge={`v${cur.v} · ${cur.profit_type}`}>
      <div className="flex flex-col gap-2.5">
        <div className="text-[12px] leading-snug" style={{ color: 'var(--desk-ink)' }}>
          {cur.claim}
        </div>

        {/* 逻辑 → 预期(命门:锚→估 + 跳变;对账态) */}
        {logic.length > 0 && (
          <ChainStep label="逻辑 → 预期">
            <div className="flex flex-col gap-1.5">
              {logic.map((l) => (
                <LogicRow key={l.key} l={l} />
              ))}
            </div>
          </ChainStep>
        )}

        {/* 预期 → 估值(V 三情景) */}
        {trace?.ok && trace.V && (
          <ChainStep label="预期 → 估值">
            <div className="flex items-center gap-3 text-[12px]">
              <VChip label="熊" v={trace.V.bear} />
              <VChip label="中" v={trace.V.base} strong />
              <VChip label="牛" v={trace.V.bull} />
              <span className="text-[10.5px]" style={{ color: 'var(--desk-subtle)' }}>
                {cur.valuation.method.toUpperCase()}
              </span>
            </div>
          </ChainStep>
        )}

        {/* 估值 → 决策(安全边际买点) */}
        {sv && (
          <ChainStep label="估值 → 决策">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              {sv.price != null && (
                <span style={{ color: 'var(--desk-mute)' }}>
                  现价 <b style={{ color: 'var(--desk-ink)' }}>{sv.price}</b>
                </span>
              )}
              {sv.buyTrigger != null && (
                <span style={{ color: 'var(--desk-mute)' }}>
                  买点 ≤ <b style={{ color: 'var(--desk-ink)' }}>{round1(sv.buyTrigger)}</b>
                </span>
              )}
              <span
                className="px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                style={
                  sv.atBuyPoint
                    ? { background: '#3fb9501f', color: '#3fb950' }
                    : { background: '#8b98a91f', color: 'var(--desk-mute)' }
                }
              >
                {sv.atBuyPoint ? '进安全边际' : '未到买点'}
              </span>
            </div>
          </ChainStep>
        )}

        {/* 决策落点 */}
        {decision && (
          <ChainStep label="决策">
            <div className="text-[11.5px]" style={{ color: 'var(--desk-ink)' }}>
              <b>{decision.trade}</b>
              {decision.weight != null ? ` · 仓位 ${decision.weight}` : ''}
              <span className="ml-1.5" style={{ color: 'var(--desk-subtle)' }}>
                {decision.reason}
              </span>
            </div>
          </ChainStep>
        )}
      </div>
    </Section>
  )
}

function LogicRow({ l }: { l: LogicLine }) {
  const color = l.broken ? '#f85149' : l.bigJump ? '#d29922' : 'var(--desk-mute)'
  return (
    <div
      className="rounded-md px-2 py-1.5"
      style={{ background: 'var(--desk-bg)', border: '1px solid var(--desk-line)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--desk-ink)' }}>
          {l.label}
        </span>
        <span className="text-[10.5px] font-mono" style={{ color }}>
          {l.anchor ?? '—'}
          {l.unit} → {l.est ?? '—'}
          {l.unit}
          {l.jump != null ? ` (${l.jump > 0 ? '+' : ''}${l.jump})` : ''}
        </span>
      </div>
      <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--desk-subtle)' }}>
        {l.logic}
        {l.broken && ' · 锚缺失·链断'}
        {l.bigJump && !l.broken && ' · 大跳变·需强逻辑'}
        {l.actual != null && (
          <span style={{ color: l.conv === '背离' ? '#f85149' : 'var(--desk-mute)' }}>
            {' '}
            · 实 {l.actual}
            {l.conv ? `(${l.conv})` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

// ═══ 下:事实 ═════════════════════════════════════════════════
function FactsPanel({ view }: { view: CardBundle | null }) {
  const facts = view?.facts ?? {}
  const fresh = useMemo(() => factFreshness(facts), [facts])
  const keys = Object.keys(facts)
  return (
    <Section title="事实" badge={`${keys.length}`}>
      {keys.length === 0 ? (
        <Muted>此时点尚无事实</Muted>
      ) : (
        <div className="flex flex-col gap-1">
          {keys.map((k) => {
            const f = facts[k]
            const last = f.series[f.series.length - 1]
            const ff = fresh[k]
            return (
              <div key={k} className="flex items-center justify-between gap-2 text-[11px]">
                <span style={{ color: 'var(--desk-mute)' }}>
                  {f.label}
                  {f.role === '排雷' && (
                    <span className="ml-1" style={{ color: 'var(--desk-subtle)' }}>
                      排雷
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <b className="font-mono" style={{ color: 'var(--desk-ink)' }}>
                    {last?.value}
                  </b>
                  <span className="font-mono text-[9.5px]" style={{ color: 'var(--desk-subtle)' }}>
                    {last?.as_of}
                  </span>
                  {ff?.stale && (
                    <span
                      className="px-1 rounded text-[9px]"
                      style={{ background: '#d299221f', color: '#d29922' }}
                    >
                      过时
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ═══ 通用小件 ════════════════════════════════════════════════
function Section(props: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-lg p-3"
      style={{ background: 'var(--desk-panel)', border: '1px solid var(--desk-line)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--desk-ink)' }}>
          {props.title}
        </span>
        {props.badge && (
          <span className="text-[10px]" style={{ color: 'var(--desk-subtle)' }}>
            {props.badge}
          </span>
        )}
      </div>
      {props.children}
    </section>
  )
}

function ChainStep({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 text-[10px] pt-0.5 w-[68px]" style={{ color: 'var(--desk-subtle)' }}>
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function VChip({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[9.5px]" style={{ color: 'var(--desk-subtle)' }}>
        {label}
      </span>
      <b
        className="font-mono"
        style={{
          color: strong ? 'var(--desk-accent)' : 'var(--desk-ink)',
          fontSize: strong ? 13 : 12,
        }}
      >
        {round1(v)}
      </b>
    </span>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11.5px] py-4 text-center" style={{ color: 'var(--desk-subtle)' }}>
      {children}
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
