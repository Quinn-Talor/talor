// src/renderer/invest/stockCardUI.tsx —— renderer: 标的卡 ArtifactUI(Inline chip + Panel 案卷)
//
// 终稿模型(docs/investment-agent/{README.md,value-chain-rigor.md}):
//   案卷 = 决策面(散户层链条 ①逻辑→②估值→③安全边际→④决策)+ 三下钻(专业层)。
//   价值传导:事实→逻辑(命门)→预测参数(valuation.assumptions)→compute估值V→安全边际→决策。
//   时间线:复查=验证(双向 outcome→validity)+重立;决策基于逻辑版本。
// 写经工具(LLM),读经平台通用 artifact:read IPC(UI 只读,不算价值)。

import { useEffect, useState } from 'react'
import type { ArtifactUI } from '../artifacts/registry'
import type { ChatMessage } from '../types/chat'
import type {
  CardBundle,
  Fact,
  Facts,
  FactObservation,
  ValuationAssumption,
  VRange,
} from '@shared/types/invest'
import {
  summarizeHealth,
  latestCheckpoint,
  latestValidity,
  latestConviction,
  currentThesis,
  coreAssumptions,
  dualLines,
  safety,
  redLines,
  timelineRows,
  valuationTrace,
  recompute,
  timelineTrajectory,
  type Health,
  type Recompute,
} from './summarizeHealth'
import { anchorValue, resolveForecast, type ValuationTrace } from '@shared/invest/valuation-trace'

// ============ Inline chip ============
interface CardRef {
  id: string
  code?: string
  name?: string
}
function findCardRefs(message: ChatMessage): CardRef[] {
  const refs: CardRef[] = []
  const seen = new Set<string>()
  const visit = (v: unknown): void => {
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (o.type === 'stock_card' && typeof o.id === 'string' && !seen.has(o.id)) {
      seen.add(o.id)
      const head = (o.head ?? {}) as Record<string, unknown>
      refs.push({
        id: o.id,
        code: typeof head.code === 'string' ? head.code : undefined,
        name: typeof head.name === 'string' ? head.name : undefined,
      })
    }
    for (const key of Object.keys(o)) visit(o[key])
  }
  try {
    visit(typeof message.content === 'string' ? JSON.parse(message.content) : message.content)
  } catch {
    /* 非 JSON → 无卡引用 */
  }
  return refs
}
function Inline({ message, onSelect }: { message: ChatMessage; onSelect: (id: string) => void }) {
  const refs = findCardRefs(message)
  if (refs.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          title="打开案卷"
        >
          <span>🗂️</span>
          <span className="font-medium">{r.code ? `${r.code} ${r.name ?? ''}` : r.id}</span>
        </button>
      ))}
    </div>
  )
}

// ============ 配色 ============
const VERDICT_CLR: Record<string, string> = {
  买: 'text-emerald-600',
  等: 'text-amber-600',
  弃: 'text-red-600',
  减: 'text-orange-600',
}
const GATE_CLR: Record<string, string> = {
  通行: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  警告: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  节流: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  否决: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}
// validity → 显示文案 + 颜色(双向:强化/持有=好,校准=动摇,证伪=破)
const VALIDITY_CN: Record<string, string> = {
  强化: '强化',
  持有: '持有',
  校准: '校准·动摇',
  证伪: '证伪·破',
}
const VALIDITY_CLR: Record<string, string> = {
  强化: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  持有: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  校准: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  证伪: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}
const CONV_CN: Record<string, string> = { high: '高', mid: '中', low: '低' }
const GRADE_CLR: Record<string, string> = {
  优: 'text-emerald-600',
  良: 'text-emerald-600',
  平庸: 'text-amber-600',
  不过: 'text-red-600',
}
const HEALTH_CN: Record<Health, string> = {
  green: '稳健',
  yellow: '动摇',
  red: '受损',
  none: '未建',
}
const HEALTH_CLR: Record<Health, string> = {
  green: 'text-emerald-600',
  yellow: 'text-amber-600',
  red: 'text-red-600',
  none: 'text-neutral-500',
}
const CONV_LINE_CLR: Record<string, string> = {
  强化: 'text-emerald-600',
  持有: 'text-neutral-500',
  背离: 'text-amber-600',
}
const OUTCOME_CLR: Record<string, string> = {
  超预期: 'text-emerald-600',
  兑现: 'text-emerald-600',
  容差: 'text-neutral-500',
  偏离: 'text-amber-600',
  破: 'text-red-600',
}
const QUALITY_CN: Record<string, string> = { healthy: '健康', mixed: '掺杂', deteriorating: '恶化' }
const QUALITY_CLR: Record<string, string> = {
  healthy: 'text-emerald-600',
  mixed: 'text-amber-600',
  deteriorating: 'text-red-600',
}
const SIGNAL_PILL: Record<string, string> = {
  good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  neutral: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
}
const ATTR_CLR: Record<string, string> = {
  噪声: 'text-neutral-500',
  外生: 'text-neutral-500',
  参数错: 'text-amber-600',
  机制错: 'text-red-600',
}
const LEVEL_CN: Record<string, string> = { industry: '行业', company: '公司', macro: '宏观' }
const ROLE_PILL: Record<string, string> = {
  先行: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  排雷: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  同步: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
  滞后: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
}
const trendArrow = (t?: string) => (t === 'up' ? '↑' : t === 'down' ? '↓' : t === 'flat' ? '→' : '')
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const railClr = (v: number) =>
  v >= 2 ? 'border-blue-400 dark:border-blue-500' : 'border-neutral-300 dark:border-neutral-600'

// ============ 折叠下钻(含折叠态嗅探角标)============
type DrillFlag = { text: string; tone: 'red' | 'amber' | 'blue' } | null
const FLAG_DOT: Record<string, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
}
function Collapse({
  title,
  hint,
  flag,
  children,
}: {
  title: string
  hint?: string
  flag?: DrillFlag
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="border-t border-neutral-200 py-1.5 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200">
          <span className="text-neutral-400">{open ? '▾' : '▸'}</span>
          {title}
          {flag && (
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${FLAG_DOT[flag.tone]}`}
              aria-hidden="true"
            />
          )}
        </span>
        {flag && !open ? (
          <span className="text-[11px] text-neutral-400">{flag.text}</span>
        ) : (
          hint && <span className="text-[11px] text-neutral-400">{hint}</span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  )
}

// ============ 顶条(逻辑健康 + gate + verdict;无价格)============
function TopBar({ bundle }: { bundle: CardBundle }) {
  const { head } = bundle
  const cur = currentThesis(bundle)
  const cp = latestCheckpoint(bundle)
  const { health, gate } = summarizeHealth(bundle)
  const verdict = cp?.signal?.verdict ?? null
  const gb = bundle.eligibility?.good_business
  return (
    <div className="mb-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">
            {head.code} {head.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span>
              {head.status === 'held' ? '持有' : head.status === 'closed' ? '已平' : '观察'}
            </span>
            {head.bucket === 'satellite' && (
              <span className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-500 dark:bg-neutral-800">
                卫星仓
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          {verdict && (
            <div className={`text-xl font-semibold leading-none ${VERDICT_CLR[verdict] ?? ''}`}>
              {verdict}
            </div>
          )}
          {gate && (
            <span
              className={`mt-1.5 inline-block rounded px-2 py-0.5 text-[11px] font-medium ${GATE_CLR[gate] ?? ''}`}
            >
              gate {gate}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
        <span>
          逻辑 <b className={HEALTH_CLR[health]}>{HEALTH_CN[health]}</b>
        </span>
        {cur && (
          <>
            <span className="text-neutral-300">·</span>
            <span>
              v{cur.v}·{cur.scope}
            </span>
          </>
        )}
        {gb && (
          <>
            <span className="text-neutral-300">·</span>
            <span>
              好生意 <b className={GRADE_CLR[gb.grade] ?? ''}>{gb.grade}</b> · 护城河{gb.moat.type}·
              {gb.moat.durability}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// ============ ① 双线一行(估 vs 实 + 双向 conv)============
function DualRow({ line }: { line: ReturnType<typeof dualLines>['lines'][number] }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-500">
        {line.metric}
        {line.high && <span className="ml-0.5 text-amber-500">★</span>}
      </span>
      <span>
        估 <b>{line.projected}</b>
      </span>
      {line.actual != null && (
        <>
          <span className="text-neutral-400">→ 实</span>
          <b className={line.conv === '背离' ? 'text-amber-600' : 'text-emerald-600'}>
            {line.actual}
          </b>
          {line.conv && (
            <span className={`ml-auto text-[11px] ${CONV_LINE_CLR[line.conv] ?? ''}`}>
              {line.conv}
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ============ ③ 安全边际尺(估值带 + 现价偏差)============
function SafetyGauge({ V, price, buyTrigger }: { V: VRange; price?: number; buyTrigger?: number }) {
  const lo = Math.min(V.bear, price ?? V.bear, buyTrigger ?? V.bear) * 0.97
  const hi = Math.max(V.bull, price ?? V.bull)
  const span = hi - lo || 1
  const x = (v: number) => 20 + ((v - lo) / span) * 300
  const buyX = buyTrigger != null ? x(buyTrigger) : null
  return (
    <svg viewBox="0 0 340 30" width="100%" height="30" role="img" aria-label="安全边际价值尺">
      {buyX != null && (
        <rect
          x="20"
          y="12"
          width={Math.max(0, buyX - 20)}
          height="7"
          rx="3"
          className="fill-emerald-100 dark:fill-emerald-900/40"
        />
      )}
      <line
        x1="20"
        y1="15.5"
        x2="320"
        y2="15.5"
        className="stroke-neutral-300 dark:stroke-neutral-600"
        strokeWidth="2"
      />
      <line
        x1={x(V.bear)}
        y1="11"
        x2={x(V.bear)}
        y2="20"
        className="stroke-neutral-400"
        strokeWidth="1"
      />
      <line
        x1={x(V.base)}
        y1="11"
        x2={x(V.base)}
        y2="20"
        className="stroke-neutral-400"
        strokeWidth="1"
      />
      <text x={x(V.bear)} y="29" fontSize="11" textAnchor="middle" className="fill-neutral-400">
        熊{V.bear}
      </text>
      <text x={x(V.base)} y="29" fontSize="11" textAnchor="middle" className="fill-neutral-400">
        中{V.base}
      </text>
      {price != null && (
        <>
          <polygon
            points={`${x(price)},5 ${x(price) - 5},12 ${x(price) + 5},12`}
            className="fill-amber-500"
          />
          <text x={x(price)} y="4" fontSize="11" textAnchor="middle" className="fill-amber-600">
            现价{price}
          </text>
        </>
      )}
    </svg>
  )
}

// ============ 决策面(散户层链条 ①逻辑→②估值→③安全边际→④决策)============
function DecisionSurface({ bundle }: { bundle: CardBundle }) {
  const cur = currentThesis(bundle)
  const cp = latestCheckpoint(bundle)
  if (!cur) return <div className="mb-3 text-xs text-neutral-500">尚无逻辑(补全事实后立逻辑)。</div>
  const claim = cur.claim
  const dl = dualLines(bundle)
  const sv = safety(bundle)
  const rl = redLines(bundle)
  const validity = latestValidity(bundle)
  const conviction = latestConviction(bundle)
  const vt = valuationTrace(cur, bundle.facts) // V_now:当前版从最新事实活算
  const rc = recompute(bundle)
  const V = vt?.ok && vt.V ? vt.V : (cp?.value_now?.V ?? cur.valuation.V)
  const vOld = rc.active ? rc.priorByOut['V'] : undefined
  // 当前仓位:最近一次 建/加 的 weight
  const lastOpen = [...bundle.timeline]
    .reverse()
    .find((e) => e.type === '决策' && (e.trade === '建' || e.trade === '加'))
  const weight = lastOpen && lastOpen.type === '决策' ? lastOpen.weight : undefined

  return (
    <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <div className="mb-1.5 text-[11px] font-medium text-neutral-500">
        盯逻辑 · 事实 → 逻辑 → 估值 → 决策
      </div>

      {/* ① 逻辑成立?(大白话 + validity + 双线)*/}
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-neutral-500">① 逻辑成立?</span>
        {validity && (
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${VALIDITY_CLR[validity] ?? ''}`}
          >
            {VALIDITY_CN[validity] ?? validity}
          </span>
        )}
      </div>
      <div className="mb-2 text-sm text-neutral-800 dark:text-neutral-200">{claim}</div>
      <div className="space-y-1">
        {dl.lines.map((l, i) => (
          <DualRow key={i} line={l} />
        ))}
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">
        {dl.realizedPct != null && <>兑现度 {pct(dl.realizedPct)} · </>}
        {conviction && <>确信度 {CONV_CN[conviction] ?? conviction} · </>}红线未破
      </div>

      {/* ② 估值(校准期显 V 旧→新 + 桥;恒等式详见 逻辑·估值 ladder)*/}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-indigo-100 pt-2 text-xs dark:border-indigo-900/40">
        <span className="text-[11px] font-medium text-neutral-500">② 估值</span>
        <span>
          值{' '}
          {vOld != null ? (
            <>
              <s className="text-neutral-400">¥{vOld}</s> → <b>¥{V.base}</b>
            </>
          ) : (
            <b>¥{V.base}</b>
          )}
        </span>
        <span className="text-neutral-400">
          熊{V.bear} ~ 牛{V.bull} · {cur.valuation.method}
        </span>
        {rc.active && rc.changedParams.length > 0 && (
          <span className="ml-auto text-[11px] text-amber-600">
            {rc.changedParams[0]}校准 · 见下钻
          </span>
        )}
      </div>

      {/* ③ 安全边际(价格只在此)*/}
      {sv && (
        <div className="mt-2 rounded bg-white/60 px-2 py-1.5 dark:bg-neutral-800/40">
          <div className="mb-0.5 text-[11px] font-medium text-neutral-500">
            ③ 安全边际 · 现价 vs 估值
          </div>
          <SafetyGauge V={V} price={sv.price} buyTrigger={sv.buyTrigger} />
          <div className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-300">
            vs熊 <b>{sv.toBear ?? '—'}</b> · {sv.vsRequired ?? ''}
            <b className={sv.atBuyPoint ? 'ml-1 text-emerald-600' : 'ml-1 text-amber-600'}>
              {sv.atBuyPoint ? '到买点' : '未到买点'}
            </b>
            {!sv.atBuyPoint && sv.buyTrigger != null && (
              <span className="text-neutral-500"> → 等回调 ¥{sv.buyTrigger} 以下</span>
            )}
          </div>
        </div>
      )}

      {/* 红线 */}
      {rl.length > 0 && (
        <div className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          <span className="text-red-500">红线 </span>
          {rl.join(' / ')}
        </div>
      )}

      {/* ④ 决策 */}
      {cp?.signal && (
        <div className="mt-2 border-t border-indigo-100 pt-2 text-xs dark:border-indigo-900/40">
          <span className="text-[11px] font-medium text-neutral-500">④ 现在 </span>
          <b className={VERDICT_CLR[cp.signal.verdict] ?? ''}>{cp.signal.verdict}</b>
          {weight != null && <span className="ml-1 text-neutral-500">· 仓位 {pct(weight)}</span>}
          <span className="ml-1 text-neutral-500">— {cp.signal.reason} · 非荐股</span>
        </div>
      )}
    </div>
  )
}

// ============ 下钻 · 事实(三维 · 分层)============
function FactRow({ k, fact }: { k: string; fact: Fact }) {
  const obs: FactObservation | undefined = fact.series[fact.series.length - 1]
  if (!obs) return null
  const c = obs.change
  const s = obs.structure
  return (
    <li className="border-t border-neutral-100 py-1 first:border-t-0 dark:border-neutral-800">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="w-16 shrink-0 text-neutral-500">{fact.label ?? k}</span>
        <span className="font-medium text-neutral-700 dark:text-neutral-200">
          {String(obs.value)}
        </span>
        {c?.trend && <span className="text-neutral-400">{trendArrow(c.trend)}</span>}
        {c?.trend_note && <span className="text-[11px] text-neutral-400">{c.trend_note}</span>}
        {c?.turnover_days != null && (
          <span className="text-[11px] text-indigo-500">周转{c.turnover_days}天</span>
        )}
        {c?.turnover_trend && (
          <span className="text-[11px] text-amber-500">{c.turnover_trend}</span>
        )}
        {fact.role && (
          <span className={`ml-auto rounded px-1 text-[11px] ${ROLE_PILL[fact.role] ?? ''}`}>
            {fact.role === '先行' ? '先行·验证主力' : fact.role}
          </span>
        )}
        <span
          className={`text-[11px] text-neutral-400 ${fact.role ? '' : 'ml-auto'}`}
          title="数据时点(最新观测 as_of)"
        >
          @{obs.as_of}
        </span>
        <span className="text-[11px] text-neutral-300">{obs.tier ?? obs.source}</span>
      </div>
      {s && (
        <div className="mt-0.5 pl-[72px] text-[11px] text-neutral-500">
          <span className="text-neutral-400">结构 </span>
          {s.note}
          {s.quality && (
            <b className={`ml-1 ${QUALITY_CLR[s.quality] ?? ''}`}>
              · {QUALITY_CN[s.quality] ?? s.quality}
            </b>
          )}
          {s.components?.map((cc, i) => (
            <span
              key={i}
              className={`ml-1 rounded px-1 py-px text-[11px] ${SIGNAL_PILL[cc.signal ?? 'neutral'] ?? ''}`}
            >
              {cc.name}
              {cc.value ? ` ${cc.value}` : ''}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}
function FactsDrill({ facts }: { facts: CardBundle['facts'] }) {
  const entries = Object.entries(facts ?? {})
  if (entries.length === 0) return <div className="text-[11px] text-neutral-400">暂无事实。</div>
  const leads = entries.filter(([, f]) => f.role === '先行')
  const rest = entries.filter(([, f]) => f.role !== '先行')
  return (
    <>
      {leads.length > 0 && (
        <div className="mb-1.5">
          <div className="text-[11px] font-medium text-blue-600 dark:text-blue-300">
            先行 · 验证主力
          </div>
          <ul>
            {leads.map(([k, f]) => (
              <FactRow key={k} k={k} fact={f} />
            ))}
          </ul>
        </div>
      )}
      {(['company', 'industry', 'macro'] as const).map((lvl) => {
        const fs = rest.filter(([, f]) => f.level === lvl)
        if (fs.length === 0) return null
        return (
          <div key={lvl} className="mb-1.5">
            <div className="text-[11px] text-neutral-400">
              {LEVEL_CN[lvl]}
              {lvl === 'company' && ' · 通用 + 行业特殊'}
            </div>
            <ul>
              {fs.map(([k, f]) => (
                <FactRow key={k} k={k} fact={f} />
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

// ============ 下钻 · 逻辑·估值(价值传导:assumptions 参数表 + 恒等式 + V + 版本史)============
function AssumptionRow({ a, facts }: { a: ValuationAssumption; facts: Facts }) {
  const core = !!a.logic
  const unit = a.unit ?? ''
  const f = a.forecast
  const proj = f.mode !== 'absolute'
  const future = resolveForecast([a], facts, 'now')[0]
  const anchor = proj ? anchorValue(facts, a.anchor, 'now') : NaN
  const broken = proj && !Number.isFinite(anchor)
  const op = f.mode === 'delta' ? '+' : '×'
  return (
    <li
      className={
        broken
          ? 'rounded border-l-2 border-red-400 bg-red-50 p-1.5 dark:border-red-500 dark:bg-red-950/30'
          : core
            ? 'rounded border-l-2 border-blue-400 bg-neutral-50 p-1.5 dark:border-blue-500 dark:bg-neutral-800/40'
            : 'rounded border border-neutral-200 p-1.5 dark:border-neutral-700'
      }
    >
      <div className="text-xs font-medium">
        {core && <span className="text-amber-500">★ </span>}
        {a.label}
        {a.logic && <span className="text-neutral-400"> ← {a.logic}</span>}
        {core && <span className="ml-1 text-[10px] text-blue-500">命门</span>}
      </div>
      <div className="mt-0.5 space-y-0.5 text-[11px] text-neutral-500">
        {/* 计算过程:锚(最新事实) → 推测 → 未来三档(proj);或直取(absolute);断环标红 */}
        {proj ? (
          broken ? (
            <div className="font-medium text-red-500">
              ⚠ 估值链断:锚缺失({a.anchor?.fact ?? '未挂事实'} 无最新事实,无法推算)
            </div>
          ) : (
            <div>
              锚{' '}
              <b className="text-neutral-700 dark:text-neutral-200">
                {anchor}
                {unit}
              </b>
              （{a.anchor?.fact}·最新){` ${op} `}熊{f.bear}/中{f.base}/牛{f.bull} → 未来{' '}
              <b className="text-neutral-700 dark:text-neutral-200">
                {future.bear}/{future.base}/{future.bull}
                {unit}
              </b>
            </div>
          )
        ) : (
          <div>
            预估 熊{f.bear}/中{f.base}/牛{f.bull}
            {unit}
            <span className="text-neutral-400">（{a.anchor?.fact ?? '—'}·直取)</span>
          </div>
        )}
        {a.verify && a.verify.length > 0 && (
          <div>验证 {a.verify.map((v) => `${v.fact}(${v.role ?? v.at})`).join(' · ')}</div>
        )}
        {a.falsify_if && (
          <div>
            证伪 <span className="text-red-500">{a.falsify_if}</span>
          </div>
        )}
        {a.market_implied && <div>市场隐含 {a.market_implied}(预期差对照)</div>}
      </div>
    </li>
  )
}
// 恒等式阶梯:参数→中间量→V;本期变动的步 inline 显「旧→新」(恒等式与重算合一)。
function Ladder({
  trace,
  rc,
  assumps,
  facts,
}: {
  trace: ValuationTrace
  rc: Recompute
  assumps: ValuationAssumption[]
  facts: Facts
}) {
  const byKey = new Map(assumps.map((a) => [a.key, a]))
  // 推算后的参数当前值(命门 delta/factor → 解析成代入引擎的绝对数;显真实代入值,非原始增量)
  const resolved = new Map(resolveForecast(assumps, facts, 'now').map((r) => [r.key, r]))
  const paramVal = (k: string): string => {
    const a = byKey.get(k)
    const r = resolved.get(k)
    const u = a?.unit ?? ''
    return `${a?.label ?? k} ${r?.base ?? a?.forecast?.base ?? '?'}${u}`
  }
  // 左侧算式 = 具体运算数(不要黑盒):首步多参相乘;后续「上一中间量 op 参数」,每步代入真实数值逐环可验。
  const lhs = (s: ValuationTrace['steps'][number], i: number): string => {
    if (s.inputs.length >= 2) return s.inputs.map(paramVal).join(' × ')
    const op = s.expr.trim().startsWith('÷') ? '÷' : '×'
    const prev = trace.steps[i - 1]
    const prevTxt = prev ? `${prev.base}${prev.unit ?? ''}` : ''
    if (s.inputs.length === 1) return `${prevTxt} ${op} ${paramVal(s.inputs[0])}`.trim()
    return prevTxt ? `${prevTxt} ${s.expr}` : s.expr // 0 参数(中间量相加减,如 dcf 企业价值)
  }
  return (
    <div className="overflow-hidden rounded border border-neutral-200 dark:border-neutral-700">
      {trace.steps.map((s, i) => {
        const changed = rc.active && rc.changed.includes(s.out)
        const paramChanged = rc.active && s.inputs.some((k) => rc.paramPrior[k] != null)
        const old = rc.priorByOut[s.out]
        const isV = s.out === 'V'
        return (
          <div
            key={i}
            className={`grid grid-cols-[1fr_auto] items-baseline gap-2 px-2 py-1 text-[11px] ${
              i > 0 ? 'border-t border-neutral-100 dark:border-neutral-800' : ''
            } ${changed ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
          >
            <span className={changed ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'}>
              {lhs(s, i)}
              {paramChanged && <span className="ml-1">⚠</span>}
            </span>
            <span
              className={`whitespace-nowrap text-right ${changed ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-600 dark:text-neutral-300'}`}
            >
              <span className="text-neutral-400">= </span>
              {s.out}{' '}
              {changed && old != null ? (
                <>
                  <s className="text-neutral-400">{old}</s>→
                  <b className={isV ? 'text-xs' : ''}>
                    {s.base}
                    {s.unit}
                  </b>
                </>
              ) : (
                <b className={isV ? 'text-xs' : ''}>
                  {s.base}
                  {s.unit}
                </b>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ThesisDrill({ bundle }: { bundle: CardBundle }) {
  const t = bundle.thesis
  const cur = currentThesis(bundle)
  if (!t || !cur) return <div className="text-[11px] text-neutral-400">尚无逻辑。</div>
  const v = cur.valuation
  const cores = coreAssumptions(cur)
  const support = v.assumptions.filter((a) => !a.logic)
  const vt = valuationTrace(cur, bundle.facts) // 下钻阶梯:从最新事实活算
  const rc = recompute(bundle)
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-neutral-500">
        {cur.profit_type} · {v.method} · {cur.claim}
      </div>

      {/* 本期校准驱动事实(校准/重写期才显)*/}
      {rc.active && rc.drivingFact && (
        <div className="text-[11px] text-amber-600">
          <span aria-hidden="true">↻ </span>本期校准 ← {rc.drivingFact}(变动步显 旧→新)
        </div>
      )}

      {/* 恒等式阶梯(参数→中间量→V)+ 重算合一;缺参数/配模式未实现 → 回退显存量 V */}
      {vt?.ok && vt.steps.length > 0 ? (
        <Ladder trace={vt} rc={rc} assumps={v.assumptions} facts={bundle.facts} />
      ) : (
        <div className="rounded bg-neutral-50 px-2 py-1.5 text-xs dark:bg-neutral-800/60">
          价值 V ¥{v.V.base}（熊{v.V.bear}/牛{v.V.bull}）
          {vt && !vt.ok && (
            <span className="ml-1 text-[11px] text-neutral-400">· 恒等式待补参数/配模式</span>
          )}
        </div>
      )}
      <div className="text-[11px] text-neutral-400">
        <span className="text-amber-500">★命门</span> {cores.map((a) => a.label).join('·') || '—'} ·
        支撑 {support.map((a) => a.label).join('/') || '—'} · 安全边际门槛{' '}
        {Math.round((v.margin_of_safety.required ?? 0) * 100)}%
      </div>

      {/* 命门审计:逐参数 立足→验证→证伪→市场隐含 */}
      <ul className="space-y-1.5">
        {cores.map((a, i) => (
          <AssumptionRow key={i} a={a} facts={bundle.facts} />
        ))}
      </ul>

      <div className="text-[11px] text-neutral-400">
        版本史 → <span className="text-blue-500">见时间线</span>(时光机切版本)
      </div>
    </div>
  )
}

// ============ 下钻 · 时间线(整合因果轴:复查验证双向 + 重立 + 决策基于vN)============
function TimelineDrill({ bundle }: { bundle: CardBundle }) {
  const rows = timelineRows(bundle)
  if (rows.length === 0) return <div className="text-[11px] text-neutral-400">暂无时间线。</div>
  const traj = timelineTrajectory(bundle)
  return (
    <div>
      {/* 轨迹条:逻辑/确信/价值/仓位 走势一眼看完(§8.4 时光机)*/}
      {(traj.validitySeq.length > 0 || traj.vSeq.length > 1) && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 rounded bg-neutral-50 px-2 py-1.5 text-[11px] dark:bg-neutral-800/60">
          {traj.validitySeq.length > 0 && (
            <span>
              逻辑{' '}
              <b className="text-neutral-700 dark:text-neutral-200">{traj.validitySeq.join('→')}</b>
            </span>
          )}
          {traj.convictionSeq.some(Boolean) && (
            <span>
              确信{' '}
              <b className="text-neutral-700 dark:text-neutral-200">
                {traj.convictionSeq.map((c) => (c ? CONV_CN[c] : '—')).join('→')}
              </b>
            </span>
          )}
          {traj.vSeq.length > 0 && (
            <span>
              V <b className="text-neutral-700 dark:text-neutral-200">{traj.vSeq.join('→')}</b>
            </span>
          )}
          {traj.position != null && (
            <span>
              仓位 <b className="text-neutral-700 dark:text-neutral-200">{pct(traj.position)}</b>
            </span>
          )}
        </div>
      )}
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-neutral-400">
        <span>脊梁 = 逻辑版本</span>
        <span className="rounded bg-blue-100 px-1 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          v≥2
        </span>
        <span className="rounded bg-neutral-100 px-1 text-neutral-500 dark:bg-neutral-800">v1</span>
        <span className="ml-auto">最新在上 ↑</span>
      </div>
      <ul>
        {rows.map((r, i) => {
          const cp = r.kind === '复查' && r.event?.type === '复查' ? r.event : null
          const dec = r.kind === '决策' && r.event?.type === '决策' ? r.event : null
          const rev = r.kind === '复盘' && r.event?.type === '复盘' ? r.event : null
          return (
            <li key={i} className="flex gap-2">
              <div className={`relative w-3 shrink-0 border-l-2 ${railClr(r.version)}`}>
                <span
                  className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${
                    r.kind === '复盘'
                      ? 'bg-emerald-500'
                      : r.kind === '决策'
                        ? 'bg-blue-500'
                        : r.isStep
                          ? 'bg-blue-400 ring-2 ring-blue-200 dark:ring-blue-900'
                          : r.kind === '建立'
                            ? 'border border-neutral-400 bg-white dark:bg-neutral-900'
                            : 'bg-neutral-400'
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1 pb-2.5 text-[11px]">
                <div className="text-neutral-400">
                  {r.at}
                  {cp && (
                    <span>
                      {' '}
                      · 复查 锚 v{cp.against_v}
                      {cp.validity ? ` · ${cp.validity}` : ''}
                    </span>
                  )}
                  {r.kind === '建立' && <span> · 建立</span>}
                </div>

                {r.kind === '建立' && r.genesis && (
                  <div className="text-neutral-700 dark:text-neutral-200">
                    thesis{' '}
                    <span className="rounded bg-neutral-100 px-1 text-neutral-500 dark:bg-neutral-800">
                      v{r.genesis.v}
                    </span>{' '}
                    {r.genesis.claim}
                  </div>
                )}

                {cp && (
                  <>
                    {cp.checks.map((c, j) => (
                      <div key={j} className="text-neutral-700 dark:text-neutral-200">
                        {c.metric} 估{c.predicted_value != null ? String(c.predicted_value) : '—'} →
                        实{String(c.actual_value)}
                        {c.deviation?.变化 && (
                          <span className="text-neutral-400"> · {c.deviation.变化}</span>
                        )}
                        <span className={`ml-1 ${OUTCOME_CLR[c.outcome] ?? ''}`}>{c.outcome}</span>
                      </div>
                    ))}
                    <div className="text-neutral-500">
                      {cp.checks[0]?.attribution && (
                        <>
                          归因{' '}
                          <b className={ATTR_CLR[cp.checks[0].attribution.type] ?? ''}>
                            {cp.checks[0].attribution.type}
                          </b>{' '}
                        </>
                      )}
                      {r.isStep && cp.spawned_v != null ? (
                        <span className="text-blue-600">
                          → 校准 v{cp.against_v}→v{cp.spawned_v} · 重算 V¥{cp.value_now.V.base}
                        </span>
                      ) : (
                        <span className="text-neutral-500">→ 逻辑不动 · 挡噪声</span>
                      )}
                      {cp.conviction && (
                        <span className="ml-1">· 确信{CONV_CN[cp.conviction]}</span>
                      )}
                      <span className="ml-1">· {cp.signal?.verdict}</span>
                    </div>
                  </>
                )}

                {dec && (
                  <div className="text-neutral-700 dark:text-neutral-200">
                    决策 · <b>{dec.trade}</b>
                    {dec.price != null && <span> @¥{dec.price}</span>}
                    {dec.weight != null && (
                      <span className="text-neutral-400"> · 仓位{pct(dec.weight)}</span>
                    )}
                    {r.basedV != null && (
                      <span className="ml-1 rounded bg-blue-100 px-1 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        基于 v{r.basedV}
                      </span>
                    )}
                    {dec.override && <span className="ml-1 text-red-500">[override]</span>}
                    <div className="text-neutral-500">{dec.reason}</div>
                  </div>
                )}

                {rev && (
                  <div className="text-neutral-700 dark:text-neutral-200">
                    复盘 · 卫星 {pct(rev.vs_benchmark.satellite)} vs 宽基{' '}
                    {pct(rev.vs_benchmark.index)}
                    <b
                      className={
                        rev.vs_benchmark.verdict === '跑赢' ? ' text-emerald-600' : ' text-red-600'
                      }
                    >
                      {' '}
                      {rev.vs_benchmark.verdict}
                    </b>
                    {rev.lesson && <div className="text-neutral-500">教训 {rev.lesson}</div>}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ============ Panel ============
function Panel({ id }: { id: string }) {
  const [bundle, setBundle] = useState<CardBundle | null>(null)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.talorAPI.artifact.read('stock_card', id).then((b) => {
      if (!alive) return
      setBundle(b as CardBundle | null)
      setLoadedId(id)
    })
    return () => {
      alive = false
    }
  }, [id])

  if (loadedId !== id) return <div className="p-3 text-sm text-neutral-500">加载案卷…</div>
  if (!bundle) return <div className="p-3 text-sm text-neutral-500">卡不存在:{id}</div>

  // 折叠态嗅探角标:不展开也知哪有料
  const lv = latestValidity(bundle)
  const logicFlag: DrillFlag =
    lv === '证伪'
      ? { text: '命门证伪', tone: 'red' }
      : lv === '校准'
        ? { text: '命门偏·校准', tone: 'amber' }
        : null
  const det = Object.values(bundle.facts ?? {}).find(
    (f) =>
      f.role === '排雷' && f.series[f.series.length - 1]?.structure?.quality === 'deteriorating',
  )
  const factFlag: DrillFlag = det ? { text: `${det.label}恶化`, tone: 'red' } : null
  const lcp = latestCheckpoint(bundle)
  const tlFlag: DrillFlag =
    lcp?.spawned_v != null ? { text: `刚校准v${lcp.spawned_v}`, tone: 'blue' } : null

  return (
    <div className="flex flex-col overflow-y-auto p-3 text-sm">
      <TopBar bundle={bundle} />
      {bundle.eligibility && !bundle.eligibility.pass && (
        <div className="mb-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
          ✕ 未过资格赛(红灯{bundle.eligibility.red_flags}/正和
          {bundle.eligibility.source_positive ? '✓' : '✕'}/能力圈
          {bundle.eligibility.in_circle ? '✓' : '✕'})→ 不建议建仓
        </div>
      )}
      <DecisionSurface bundle={bundle} />
      <div className="text-[11px] text-neutral-400">下钻 · 专业层</div>
      <Collapse title="逻辑 · 估值" hint="方法·恒等式 参数→价格" flag={logicFlag}>
        <ThesisDrill bundle={bundle} />
      </Collapse>
      <Collapse title="事实" hint="三维 / 先行优先" flag={factFlag}>
        <FactsDrill facts={bundle.facts} />
      </Collapse>
      <Collapse title="时间线" hint="验证/矫正时光机" flag={tlFlag}>
        <TimelineDrill bundle={bundle} />
      </Collapse>
    </div>
  )
}

export const stockCardUI: ArtifactUI = {
  type: 'stock_card',
  Inline,
  Panel,
}
