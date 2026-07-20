// src/renderer/invest/ActivePaper.tsx —— 画布:时光机(tlwrap)+ 活论文(canvas-scroll)
//
// 对齐 demo:时间线滑杆 + 分型节点(脊梁=逻辑版本);卡内 maintain / tmbanner / 结论 /
// 事件详情(evd+对账表)/ 传导链(逻辑→预期 ler · 预期→估值 恒等式 ladder · 安全边际 ruler ·
// 决策)/ 三维事实 / guard。全部消费 summarizeHealth 派生 + reconstructCardAt(时光机)。
// V 现算失败(trace.ok=false)→ 回退冻结 V(修 0.2 缺陷)。拨(what-if)前端纯函数重算。

import { useEffect, useMemo, useState } from 'react'
import type {
  CardBundle,
  Checkpoint,
  DecisionEvent,
  ThesisSnapshot,
  Fact,
  FactObservation,
} from '@shared/types/invest'
import {
  reconstructCardAt,
  timelineRows,
  coreLogicLines,
  coreAssumptions,
  currentThesis,
  valuationTrace,
  safety,
  latestCheckpoint,
  timelineTrajectory,
  factFreshness,
  type TimelineRow,
} from './summarizeHealth'

function nodeClass(r: TimelineRow): string {
  if (r.kind === '建立') return 'n-build'
  if (r.kind === '决策') return 'n-dec'
  if (r.kind === '复查') {
    if (r.isStep) return 'n-ver' // 出新版
    const v = (r.event as Checkpoint | undefined)?.validity
    if (v === '证伪' || v === '校准') return 'n-warn' // 异动未换版
    return 'n-hold'
  }
  return 'n-hold'
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

export function ActivePaper({ cardId }: { cardId: string }) {
  const [bundle, setBundle] = useState<CardBundle | null>(null)
  const [cur, setCur] = useState<number | null>(null) // chronological index; null → 现在(末节点)
  const [dial, setDial] = useState<number | null>(null) // 拨:命门 forecast.base 覆盖

  useEffect(() => {
    let alive = true
    setCur(null)
    setDial(null)
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

  const chrono = useMemo(() => [...timelineRows(bundle)].reverse(), [bundle]) // 旧→新
  const lastIdx = chrono.length - 1
  const idx = cur ?? lastIdx
  const live = idx >= lastIdx
  const node = chrono[idx]
  const view = useMemo(
    () => (bundle && node && !live ? reconstructCardAt(bundle, node.at) : bundle),
    [bundle, node, live],
  )

  if (!bundle)
    return (
      <main className="canvas">
        <div className="iv-empty">载入案卷…</div>
      </main>
    )

  const cardEl = view // reconstructed-or-full

  return (
    <main className="canvas">
      <TimeMachine
        chrono={chrono}
        idx={idx}
        onPick={(i) => {
          setCur(i)
          setDial(null)
        }}
        bundle={bundle}
      />
      <div className="canvas-scroll">
        {cardEl && node && (
          <CardBody
            view={cardEl}
            node={node}
            live={live}
            dial={dial}
            onDial={setDial}
            onBackToNow={() => {
              setCur(null)
              setDial(null)
            }}
          />
        )}
      </div>
    </main>
  )
}

// ═══ 时光机 ═══════════════════════════════════════════════════
function TimeMachine(props: {
  chrono: TimelineRow[]
  idx: number
  onPick: (i: number) => void
  bundle: CardBundle
}) {
  const { chrono, idx, onPick, bundle } = props
  const traj = timelineTrajectory(bundle)
  const valSeq = traj.validitySeq.length ? traj.validitySeq.join('→') : '—'
  const maxV = Math.max(1, ...chrono.map((r) => r.version))
  const pos = traj.position != null ? `${Math.round(traj.position * 100)}%` : '0%'
  return (
    <div className="tlwrap">
      <div className="h">
        <svg className="iv-ico" viewBox="0 0 24 24" style={{ width: 12, height: 12 }}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        时间线 · 时光机 —— 脊梁=逻辑版本，节点=事件；点击节点回看那时的论文
      </div>
      <div className="traj">
        <b>逻辑</b> {valSeq} · <b>版本</b> v1→v{maxV} · <b>仓位</b> {pos}
      </div>
      <div className="tltrack">
        <div className="tlline" />
        {chrono.length > 1 && (
          <div
            className="tlline-fill"
            style={{ width: `calc((100% - 12px) * ${idx / (chrono.length - 1)})` }}
          />
        )}
        <div className="tlnodes">
          {chrono.map((r, i) => (
            <button
              key={`${r.at}-${r.kind}-${i}`}
              className={'tltk' + (i === idx ? ' on' : '')}
              onClick={() => onPick(i)}
            >
              <span className={'nd ' + nodeClass(r)} />
              <span className="tllab">
                {r.kind}
                {r.isStep && r.version > 1 && <span className="verbadge">v{r.version}</span>}
                <br />
                <span className="dd">{r.at.slice(5, 10) || r.at}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══ 卡体 ═════════════════════════════════════════════════════
function CardBody(props: {
  view: CardBundle
  node: TimelineRow
  live: boolean
  dial: number | null
  onDial: (v: number | null) => void
  onBackToNow: () => void
}) {
  const { view, node, live, dial, onDial, onBackToNow } = props
  const cur = currentThesis(view)
  const cores = coreAssumptions(cur)
  const logic = coreLogicLines(view)
  const trace = useMemo(() => (cur ? valuationTrace(cur, view.facts) : null), [cur, view])
  const sv = safety(view)
  const cp = latestCheckpoint(view)
  const traj = timelineTrajectory(view)

  // V:现算优先,失败回退冻结(修 0.2 缺陷)
  const V = trace?.ok && trace.V ? trace.V : (cur?.valuation.V ?? null)
  const vFallback = !(trace?.ok && trace.V) && !!cur?.valuation.V

  const decision = useMemo(() => {
    for (let i = view.timeline.length - 1; i >= 0; i--) {
      const e = view.timeline[i]
      if (e.type === '决策') return e as DecisionEvent
    }
    return null
  }, [view])

  const concl = cur?.claim ?? '（此时点尚无逻辑版本）'
  const action =
    node.kind === '决策'
      ? ((node.event as DecisionEvent | undefined)?.reason ?? '')
      : node.kind === '复查'
        ? ((node.event as Checkpoint | undefined)?.signal?.reason ?? '')
        : '建立首版逻辑'

  return (
    <>
      <div className="maintain">
        <span className="d" />
        AI 持续维护 · 在盯 {cores.length} 个命门
      </div>

      {!live && (
        <div className="tmbanner">
          <svg className="iv-ico" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>
            时光机：你在看{' '}
            <b>
              {node.kind} · {node.at.slice(0, 10)}
            </b>
            （历史·只读·已冻结）
          </span>
          <button className="back" onClick={onBackToNow}>
            回到现在
          </button>
        </div>
      )}

      <div className="concl">{concl}</div>
      <div className="action">{action}</div>

      <EventDetail node={node} />

      {cur && (
        <>
          <div className="facts-h">
            <span className="e">传导链 · 事实 → 逻辑 → 预期 → 估值 → 决策（当前 v{cur.v}）</span>
          </div>
          <div className="chainflow">
            {/* ① 逻辑 → 预期 */}
            <div className="cstation">
              <span className="cnode">1</span>
              <div className="cstep-h">
                逻辑 → 预期
                {cp?.conviction && <span className="r">确信 {cp.conviction}</span>}
              </div>
              {logic.length === 0 && <div className="ler">（当前版本无挂逻辑的命门）</div>}
              {logic.map((l) => {
                const cls = l.broken ? 'ler bad' : l.bigJump ? 'ler warn' : 'ler'
                const status = l.broken
                  ? '链断·缺锚'
                  : l.bigJump
                    ? '大跳变·需强逻辑'
                    : (l.conv ?? '')
                return (
                  <div className={cls} key={l.key}>
                    <div>
                      ★ {l.label} ← 逻辑「{l.logic}」
                      {status && (
                        <span
                          style={{
                            color: l.broken
                              ? 'var(--bad)'
                              : l.bigJump
                                ? 'var(--warn)'
                                : 'var(--ink-2)',
                            fontWeight: 600,
                            marginLeft: 4,
                          }}
                        >
                          {status}
                        </span>
                      )}
                    </div>
                    <div className="flow">
                      锚{' '}
                      <b>
                        {l.anchor ?? '—'}
                        {l.unit}
                      </b>
                      {l.anchorAsOf ? `@${l.anchorAsOf}` : ''} → 估{' '}
                      <b>
                        {l.est ?? '—'}
                        {l.unit}
                      </b>
                      {l.actual != null && (
                        <>
                          {' '}
                          · 实测{' '}
                          <b style={{ color: l.conv === '背离' ? 'var(--warn)' : 'var(--ink-2)' }}>
                            {l.actual}
                          </b>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ② 预期 → 估值 */}
            <div className="cstation">
              <span className="cnode">2</span>
              <div className="cstep-h">
                预期 → 估值
                {V && (
                  <span className="r n">
                    值 {V.base} · 熊{V.bear}~牛{V.bull} · {cur.valuation.method}
                  </span>
                )}
              </div>
              <Ladder
                trace={trace}
                coreKeys={cores.map((c) => c.key)}
                frozenV={V}
                fallback={vFallback}
              />
              {live && cores.length > 0 && Number.isFinite(num(cores[0].forecast.base)) ? (
                <WhatIf
                  core={cores[0]}
                  snap={cur}
                  facts={view.facts}
                  dial={dial}
                  onDial={onDial}
                  price={sv?.price}
                />
              ) : (
                <div className="frozen">
                  {live ? '此命门非数值·拨不可用' : '历史值已冻结 — 拨/重算只在「现在」可用'}
                </div>
              )}
            </div>

            {/* ③ 安全边际 */}
            {sv && V && sv.price != null && sv.buyTrigger != null && (
              <div className="cstation">
                <span className="cnode good">3</span>
                <div className="cstep-h">安全边际 · 现价 vs 估值</div>
                <SafetyRuler
                  price={sv.price}
                  buy={sv.buyTrigger}
                  vbear={V.bear}
                  vbase={V.base}
                  atBuy={sv.atBuyPoint}
                />
              </div>
            )}

            {/* ④ 决策 */}
            <div className="cstation">
              <span className="cnode solid">4</span>
              <div className="cstep-h">决策</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  fontSize: 11.5,
                }}
              >
                <span
                  style={{
                    background:
                      cp?.signal?.verdict === '买' ? 'var(--good-soft)' : 'var(--surface-2)',
                    color: cp?.signal?.verdict === '买' ? 'var(--good)' : 'var(--ink-2)',
                    fontWeight: 500,
                    padding: '2px 9px',
                    borderRadius: 6,
                  }}
                >
                  {decision?.trade ? `${decision.trade}仓` : (cp?.signal?.verdict ?? '—')}
                  {traj.position != null ? ` · ${Math.round(traj.position * 100)}%` : ''}
                </span>
                <span className="mut">非荐股</span>
              </div>
            </div>
          </div>
        </>
      )}

      <FactsPanel key={view.id} view={view} asOf={node.at} />

      <div className="guard">
        每处带源 · code-verified · 逻辑按事件版本化冻结 · <b>card(任一时刻)可由时间线重建</b>
      </div>
    </>
  )
}

// ═══ 事件详情 ═════════════════════════════════════════════════
function EventDetail({ node }: { node: TimelineRow }) {
  const glyph = nodeClass(node)
  let title = node.kind
  let body = ''
  let checks: Checkpoint['checks'] = []
  if (node.kind === '建立') {
    title = `建立 · 版本 v${node.version}`
    body = node.genesis?.claim ?? '立首版逻辑与支点。'
  } else if (node.kind === '复查') {
    const e = node.event as Checkpoint | undefined
    title = `复查 · ${e?.validity ?? ''}`
    body = e?.signal?.reason ?? ''
    checks = e?.checks ?? []
  } else if (node.kind === '决策') {
    const e = node.event as DecisionEvent | undefined
    title = '决策'
    body = `${e?.trade ?? ''} · ${e?.reason ?? ''}`
  } else {
    title = '复盘'
  }
  return (
    <div className="evd">
      <div className="et">
        <span className={'glyph ' + glyph} />
        这一刻发生了什么：{title}
      </div>
      {body}
      {checks.length > 0 && (
        <table className="evtable">
          <tbody>
            <tr>
              <th>指标</th>
              <th>预测(冻结)</th>
              <th>实际</th>
              <th>结论</th>
            </tr>
            {checks.map((c, i) => {
              const oc =
                c.outcome === '破' ? 'oc-bad' : c.outcome === '偏离' ? 'oc-warn' : 'oc-good'
              return (
                <tr key={i}>
                  <td>{c.metric}</td>
                  <td>{c.predicted_value ?? '—'}</td>
                  <td>{c.actual_value}</td>
                  <td className={oc}>{c.outcome}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ═══ 恒等式 Ladder ════════════════════════════════════════════
function Ladder(props: {
  trace: ReturnType<typeof valuationTrace>
  coreKeys: string[]
  frozenV: { bear: number; base: number; bull: number } | null
  fallback: boolean
}) {
  const { trace, coreKeys, frozenV, fallback } = props
  if (fallback || !trace?.ok || trace.steps.length === 0) {
    return (
      <div className="ladder">
        <div className="lrow">
          <span className="lhs">恒等式现算缺参数 / 经济无意义</span>
          <span className="rhs">
            {frozenV ? (
              <>
                V <b>{frozenV.base}</b>
                <span className="ltag">存量</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="lfoot">回退显冻结 V(卡内快照);现算需完整命门链</div>
      </div>
    )
  }
  return (
    <div className="ladder">
      {trace.steps.map((s, i) => {
        const isCore = s.inputs.some((k) => coreKeys.includes(k))
        return (
          <div className="lrow" key={i}>
            <span className="lhs">
              <span className={'p' + (isCore ? ' core' : '')}>{s.out}</span> {s.expr}
            </span>
            <span className="rhs">
              ={' '}
              <b>
                {s.base}
                {s.unit ?? ''}
              </b>
              <span className="ltag">计算</span>
            </span>
          </div>
        )
      })}
      <div className="lfoot">命门(叶子·前值×逻辑)→ 计算(公式算出)；每步代入真实数值，逐环可验</div>
    </div>
  )
}

// ═══ 拨(what-if)══════════════════════════════════════════════
function WhatIf(props: {
  core: ThesisSnapshot['valuation']['assumptions'][number]
  snap: ThesisSnapshot
  facts: CardBundle['facts']
  dial: number | null
  onDial: (v: number) => void
  price?: number
}) {
  const { core, snap, facts, dial, onDial, price } = props
  const base = num(core.forecast.base)
  const cur = dial ?? base
  const span = Math.max(Math.abs(base) || 1, 1)
  const min = Math.round((base - span) * 10) / 10
  const max = Math.round((base + span) * 10) / 10

  const recomputed = useMemo(() => {
    const clone: ThesisSnapshot = {
      ...snap,
      valuation: {
        ...snap.valuation,
        assumptions: snap.valuation.assumptions.map((a) =>
          a.key === core.key ? { ...a, forecast: { ...a.forecast, base: cur } } : a,
        ),
      },
    }
    return valuationTrace(clone, facts)
  }, [snap, core.key, cur, facts])

  const v = recomputed?.ok && recomputed.V ? recomputed.V.base : null
  return (
    <>
      <div className="whatif">
        <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>拨 {core.label ?? core.key}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={(max - min) / 40 || 0.1}
          value={cur}
          onChange={(e) => onDial(Number(e.target.value))}
        />
        <span className="n" style={{ fontWeight: 700, color: 'var(--accent)' }}>
          {cur}
          {core.unit ?? ''}
        </span>
        <span className="lbl">数据变→链路重算</span>
      </div>
      {v != null && (
        <div
          style={{
            fontSize: 10,
            marginTop: 5,
            color: price != null && v < price ? 'var(--bad)' : 'var(--good)',
          }}
        >
          V {v}
          {price != null
            ? v < price
              ? ` < 现价 ${price} — 此假设下无安全边际`
              : ` · 对现价 ${price} 有边际`
            : ''}
        </div>
      )}
    </>
  )
}

// ═══ 安全边际 ruler ═══════════════════════════════════════════
function SafetyRuler(props: {
  price: number
  buy: number
  vbear: number
  vbase: number
  atBuy: boolean
}) {
  const { price, buy, vbear, vbase, atBuy } = props
  const lo = Math.min(vbear, price, buy) * 0.95
  const hi = vbase * 1.08
  const rng = hi - lo || 1
  const x = (v: number) => (((v - lo) / rng) * 100).toFixed(1)
  return (
    <div className="safety">
      <div className="sruler">
        <div className="strack" />
        <div className="szone" style={{ width: x(buy) + '%' }} />
        <div className="smk" style={{ left: x(vbear) + '%' }}>
          <div className="bar" style={{ background: 'var(--ink-3)' }} />
          <div className="lb mut">熊{vbear}</div>
        </div>
        <div className="smk" style={{ left: x(vbase) + '%' }}>
          <div className="bar" style={{ background: 'var(--accent)' }} />
          <div className="lb" style={{ color: 'var(--accent)' }}>
            中{vbase}
          </div>
        </div>
        <div className="smk" style={{ left: x(buy) + '%' }}>
          <div className="bar" style={{ background: 'var(--good)' }} />
          <div className="lb" style={{ color: 'var(--good)' }}>
            买{Math.round(buy * 10) / 10}
          </div>
        </div>
        <div className="smk" style={{ left: x(price) + '%' }}>
          <div className="bar" style={{ background: 'var(--ink)' }} />
          <div className="lb" style={{ color: 'var(--ink)' }}>
            现{price}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 10.5, marginTop: 2, color: atBuy ? 'var(--good)' : 'var(--ink-2)' }}>
        现价 {price} {atBuy ? '≤' : '>'} 买点 {Math.round(buy * 10) / 10} —{' '}
        {atBuy ? '已到买点' : '未到买点，等回调'}
      </div>
    </div>
  )
}

// ═══ 三维事实(可折叠:数据 · 趋势 · 结构)═══════════════════════
const ARROW: Record<string, string> = { up: '↑', down: '↓', flat: '→' }
const MOMENTUM_ZH: Record<string, string> = {
  accelerating: '加速',
  decelerating: '减速',
  reversing: '反转',
  flat: '走平',
}
const QUALITY: Record<string, { zh: string; color: string }> = {
  healthy: { zh: '健康', color: 'var(--good)' },
  mixed: { zh: '混合', color: 'var(--warn)' },
  deteriorating: { zh: '恶化', color: 'var(--bad)' },
}

/** 数值序列 → 迷你 sparkline(≥2 个可解析数值才画;末值≥首值绿、否则红)。 */
function Sparkline({ series }: { series: FactObservation[] }) {
  const vals = series.map((p) => num(p.value)).filter((n) => Number.isFinite(n))
  if (vals.length < 2) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const rng = max - min || 1
  const w = 64
  const h = 18
  const pts = vals
    .map(
      (v, i) =>
        `${((i / (vals.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 2 - ((v - min) / rng) * (h - 4)).toFixed(1)}`,
    )
    .join(' ')
  const color = vals[vals.length - 1] >= vals[0] ? 'var(--good)' : 'var(--bad)'
  return (
    <svg className="fspark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function FactsPanel({ view, asOf }: { view: CardBundle; asOf: string }) {
  const facts = view.facts
  const fresh = useMemo(() => factFreshness(facts), [facts])
  const entries = Object.entries(facts)
  const leadKeys = entries.filter(([, f]) => f.role === '先行').map(([k]) => k)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(leadKeys)) // 先行默认展开

  const allKeys = entries.map(([k]) => k)
  const allOpen = allKeys.length > 0 && allKeys.every((k) => expanded.has(k))
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const groups: [string, boolean, [string, Fact][]][] = [
    ['先行 · 验证主力', false, entries.filter(([, f]) => f.role === '先行')],
    ['公司', true, entries.filter(([, f]) => f.role !== '先行' && f.level === 'company')],
    ['行业', true, entries.filter(([, f]) => f.level === 'industry')],
    ['宏观', true, entries.filter(([, f]) => f.level === 'macro')],
  ]

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '14px 0 6px',
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            fontWeight: 600,
          }}
        >
          事实 · 全部带源（as_of ≤ {asOf.slice(0, 10)}）· 数据 · 趋势 · 结构
        </span>
        {entries.length > 0 && (
          <button
            className="facts-toggle"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(allKeys))}
          >
            {allOpen ? '收起全部' : '展开全部'}
          </button>
        )}
      </div>
      {entries.length === 0 && <div className="frozen">此时点尚无事实</div>}
      {groups.map(
        ([title, n2, list]) =>
          list.length > 0 && (
            <div key={title}>
              <div className={'fgrp' + (n2 ? ' n2' : '')}>{title}</div>
              {list.map(([k, f]) => (
                <FactRow
                  key={k}
                  f={f}
                  stale={fresh[k]?.stale ?? false}
                  open={expanded.has(k)}
                  onToggle={() => toggle(k)}
                />
              ))}
            </div>
          ),
      )}
    </>
  )
}

function FactRow({
  f,
  stale,
  open,
  onToggle,
}: {
  f: Fact
  stale: boolean
  open: boolean
  onToggle: () => void
}) {
  const last: FactObservation | undefined = f.series[f.series.length - 1]
  const ch = last?.change
  const st = last?.structure
  const rp =
    f.role === '先行' ? (
      <span className="rpill rp-lead">先行·验证主力</span>
    ) : f.role === '排雷' ? (
      <span className="rpill rp-mine">排雷</span>
    ) : null
  const sources = Array.from(new Set(f.series.map((p) => p.source))).join(' · ')
  const hasTrend = !!(
    ch?.trend ||
    ch?.trend_note ||
    ch?.yoy ||
    ch?.momentum ||
    ch?.percentile != null ||
    ch?.turnover_trend
  )
  const q = st?.quality ? QUALITY[st.quality] : null

  return (
    <div className="fcard">
      <button className="fhead" onClick={onToggle} aria-expanded={open}>
        <span className="fchev">{open ? '▾' : '▸'}</span>
        <span className="flb">{f.label}</span>
        <span className="fva">{last?.value}</span>
        {ch?.trend && <span className={'arw ' + ch.trend}>{ARROW[ch.trend]}</span>}
        {ch?.trend_note && <span className="tnote">{ch.trend_note}</span>}
        {rp && <span style={{ marginLeft: 'auto' }}>{rp}</span>}
        <span className="fas" style={{ marginLeft: rp ? 6 : 'auto' }}>
          @{last?.as_of}
          {last?.tier ? ` · ${last.tier}` : ''}
          {stale ? ' · 过时' : ''}
        </span>
      </button>
      {open && (
        <div className="fbody">
          <span className="fdim-l">数据</span>
          <div className="fdim-c">
            <span className="mono">{f.series.map((p) => p.value).join(' → ')}</span>
            <Sparkline series={f.series} />
            <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
              源 {sources} · {f.series.length} 期
            </span>
          </div>
          {hasTrend && (
            <>
              <span className="fdim-l">趋势</span>
              <div className="fdim-c">
                {ch?.trend && <span className={'arw ' + ch.trend}>{ARROW[ch.trend]} </span>}
                {ch?.trend_note ?? ch?.yoy ?? ''}
                {ch?.momentum && (
                  <>
                    {' '}
                    · 动能 <b>{MOMENTUM_ZH[ch.momentum] ?? ch.momentum}</b>
                  </>
                )}
                {ch?.percentile != null && (
                  <>
                    {' '}
                    · 历史分位 <b>{ch.percentile}%</b>
                  </>
                )}
                {ch?.turnover_trend && (
                  <>
                    {' '}
                    · 周转 <b>{ch.turnover_trend}</b>
                  </>
                )}
              </div>
            </>
          )}
          {st?.note && (
            <>
              <span className="fdim-l">结构</span>
              <div className="fdim-c">
                {st.note}
                {q && (
                  <>
                    {' '}
                    · 质量 <b style={{ color: q.color }}>{q.zh}</b>
                  </>
                )}
                {st.components?.map((c, i) => (
                  <span
                    key={i}
                    className={
                      'spill ' +
                      (c.signal === 'good' ? 'sp-good' : c.signal === 'bad' ? 'sp-bad' : 'sp-n')
                    }
                    style={{ marginLeft: 4 }}
                  >
                    {c.name}
                    {c.value ? ` ${c.value}` : ''}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
