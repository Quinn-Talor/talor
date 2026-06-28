// src/renderer/invest/summarizeHealth.ts —— renderer: 案卷派生(纯函数,可测)
//
// 案卷 = 决策面(散户层链条 ①逻辑→②估值→③安全边际→④决策)+ 三下钻(专业层)。
// 本文件把 CardBundle 派生成可渲染结构(UI 只读不算价值,见不变量③):
//   · latestCheckpoint / summarizeHealth / latestValidity —— 逻辑健康 + 双向验证态 + gate
//   · currentThesis / coreAssumptions —— 当前逻辑 + 命门(有 logic_anchor 的参数)
//   · dualLines —— ① 双线收敛(命门 估vs实 + 双向 outcome + 兑现度)
//   · safety —— ③ 安全边际(读 margin_of_safety + buy_trigger)
//   · redLines —— ④ 红线聚合(命门证伪 ∪ 排雷恶化 ∪ 8红灯)
//   · timelineRows —— 时间线整合轴(逆序 + 活跃逻辑版本 + 版本台阶 + 决策基于vN)
// 设计依据: docs/investment-agent/{README.md,value-chain-rigor.md}。

import type {
  CardBundle,
  Checkpoint,
  GateState,
  Validity,
  Conviction,
  ThesisSnapshot,
  ValuationAssumption,
  TimelineEvent,
  Facts,
} from '@shared/types/invest'
import {
  computeValuationTrace,
  resolveTraceAssumptions,
  type ValuationTrace,
} from '@shared/invest/valuation-trace'

export type Health = 'green' | 'yellow' | 'red' | 'none'

export interface HealthSummary {
  health: Health
  gate: GateState | null
}

/** 取最新「复查」事件。 */
export function latestCheckpoint(bundle: CardBundle | null): Checkpoint | null {
  if (!bundle) return null
  for (let i = bundle.timeline.length - 1; i >= 0; i--) {
    const e = bundle.timeline[i]
    if (e.type === '复查') return e
  }
  return null
}

/** 最新复查的双向验证态(强化/持有/校准/证伪);无复查→null。 */
export function latestValidity(bundle: CardBundle | null): Validity | null {
  return latestCheckpoint(bundle)?.validity ?? null
}

/** 最新复查确信度。 */
export function latestConviction(bundle: CardBundle | null): Conviction | null {
  return latestCheckpoint(bundle)?.conviction ?? null
}

/** 健康度(看最新复查 validity):证伪→red;校准→yellow;强化/持有→green;无复查→none。 */
export function summarizeHealth(bundle: CardBundle | null): HealthSummary {
  const cp = latestCheckpoint(bundle)
  if (!cp) return { health: 'none', gate: null }
  const gate = cp.gate?.state ?? null
  const v = cp.validity
  const health: Health = v === '证伪' ? 'red' : v === '校准' ? 'yellow' : 'green'
  return { health, gate }
}

/** 当前逻辑版本。 */
export function currentThesis(bundle: CardBundle | null): ThesisSnapshot | null {
  const t = bundle?.thesis
  if (!t) return null
  return t.versions.find((v) => v.v === t.current) ?? null
}

/** 命门 = 挂了 logic_anchor 的参数(支持逻辑的指标)。 */
export function coreAssumptions(snap: ThesisSnapshot | null): ValuationAssumption[] {
  return (snap?.valuation?.assumptions ?? []).filter((a) => !!a.logic_anchor)
}

/** 参数预估 → 一句话(取 base)。 */
export function projBase(a: ValuationAssumption): string {
  return a.base != null ? String(a.base) : a.bear != null ? `${a.bear}~${a.bull ?? ''}` : '—'
}

// ===== ① 双线收敛(命门 估vs实 + 双向 outcome)=====
export interface DualLine {
  metric: string // 命门 label
  high: boolean
  projected: string // 估(base)
  actual?: string // 实(最新复查对账)
  /** 收敛(兑现/超预期=强化)/ 持有(容差)/ 背离(偏离/破)。 */
  conv?: '强化' | '持有' | '背离'
}

export function dualLines(bundle: CardBundle | null): {
  lines: DualLine[]
  realizedPct: number | null
} {
  const cur = currentThesis(bundle)
  if (!cur) return { lines: [], realizedPct: null }
  const cp = latestCheckpoint(bundle)
  const byKey = new Map((cp?.checks ?? []).map((c) => [c.assumption, c]))
  const lines: DualLine[] = coreAssumptions(cur).map((a) => {
    const chk = byKey.get(a.key)
    let conv: DualLine['conv']
    if (chk) {
      conv =
        chk.outcome === '兑现' || chk.outcome === '超预期'
          ? '强化'
          : chk.outcome === '容差'
            ? '持有'
            : '背离'
    }
    return {
      metric: a.label ?? a.key,
      high: true,
      projected: projBase(a),
      actual: chk ? String(chk.actual) : undefined,
      conv,
    }
  })
  return { lines, realizedPct: cp?.value_now?.realized_pct ?? null }
}

// ===== ③ 安全边际(只读 margin_of_safety + buy_trigger)=====
export interface SafetyView {
  price?: number
  toBear?: string
  vsRequired?: string
  atBuyPoint: boolean
  buyTrigger?: number
}

export function safety(bundle: CardBundle | null): SafetyView | null {
  const cp = latestCheckpoint(bundle)
  const mos = cp?.value_now?.margin_of_safety
  if (!mos) return null
  return {
    price: cp?.value_now?.price,
    toBear: mos.to_bear,
    vsRequired: mos.vs_required,
    atBuyPoint: mos.at_buy_point,
    buyTrigger: mos.buy_trigger,
  }
}

// ===== ④ 红线(命门证伪 ∪ 排雷恶化 ∪ 8红灯)=====
export function redLines(bundle: CardBundle | null): string[] {
  const out: string[] = []
  for (const a of coreAssumptions(currentThesis(bundle))) {
    if (a.falsify) out.push(a.falsify)
  }
  for (const f of Object.values(bundle?.facts ?? {})) {
    if (f.role !== '排雷') continue
    const last = f.series[f.series.length - 1]
    if (last?.structure?.quality === 'deteriorating') {
      out.push(`${f.label}${last.structure.note ? '·' + last.structure.note : '恶化'}`)
    }
  }
  const rf = bundle?.eligibility?.red_flags ?? 0
  if (rf > 0) out.push(`出${rf}红灯`)
  return out
}

// ===== 时间线整合轴 =====
export interface TimelineRow {
  kind: '建立' | '复查' | '决策' | '复盘'
  at: string
  version: number
  isStep: boolean
  basedV?: number
  event?: TimelineEvent
  genesis?: { v: number; claim: string }
}

function versionAt(versions: ThesisSnapshot[], t: string): number {
  let v = versions[0]?.v ?? 1
  for (const ver of versions) if (ver.at <= t && ver.v > v) v = ver.v
  return v
}

export function timelineRows(bundle: CardBundle | null): TimelineRow[] {
  if (!bundle?.thesis || bundle.thesis.versions.length === 0) {
    return [...(bundle?.timeline ?? [])]
      .reverse()
      .map((e) => ({ kind: e.type, at: e.at, version: 1, isStep: false, event: e }))
  }
  const versions = [...bundle.thesis.versions].sort((a, b) => (a.at < b.at ? -1 : 1))
  const v1 = versions[0]
  const rows: TimelineRow[] = bundle.timeline.map((e) => {
    if (e.type === '决策') {
      return {
        kind: '决策',
        at: e.at,
        version: versionAt(versions, e.at),
        isStep: false,
        basedV: e.based_v ?? versionAt(versions, e.at),
        event: e,
      }
    }
    if (e.type === '复查') {
      return {
        kind: '复查',
        at: e.at,
        version: versionAt(versions, e.at),
        isStep: e.spawned_v != null,
        event: e,
      }
    }
    return { kind: '复盘', at: e.at, version: versionAt(versions, e.at), isStep: false, event: e }
  })
  rows.push({
    kind: '建立',
    at: v1.at,
    version: v1.v,
    isStep: false,
    genesis: { v: v1.v, claim: v1.claim },
  })
  rows.sort((a, b) => (a.at === b.at ? (a.kind === '建立' ? 1 : -1) : a.at < b.at ? 1 : -1))
  return rows
}

// ===== 估值恒等式阶梯 + 重算(value-chain-rigor §8.3 / §9)=====

/** 当前/给定逻辑版本的估值 trace(参数→中间量→V);无 valuation → null。 */
export function valuationTrace(snap: ThesisSnapshot | null, facts?: Facts): ValuationTrace | null {
  if (!snap?.valuation) return null
  // 锚(最新事实)→ 推算未来 → 恒等式(命门撑区间·非命门固定 base);proj_mode 缺锚 → 引擎判缺不臆造。
  const assumps = resolveTraceAssumptions(snap.valuation.assumptions, facts)
  return computeValuationTrace(snap.valuation.method, assumps)
}

/** 本期重算:当前版 vs 上一版 trace 的逐步 diff + 驱动事实(校准/重写期才 active)。 */
export interface Recompute {
  active: boolean
  priorByOut: Record<string, number> // 中间量名 → 上一版 base 值(供 UI 显 旧→新)
  changed: string[] // 变了的中间量名
  changedParams: string[] // 变了的参数 label
  paramPrior: Record<string, string | number> // 变了的参数 key → 上一版 base(供 ladder 显参数 旧→新)
  drivingFact: string | null // 驱动事实:fact@as_of 实X · 归因
}

export function recompute(bundle: CardBundle | null): Recompute {
  const empty: Recompute = {
    active: false,
    priorByOut: {},
    changed: [],
    changedParams: [],
    paramPrior: {},
    drivingFact: null,
  }
  const t = bundle?.thesis
  const cur = currentThesis(bundle)
  if (!t || !cur) return empty
  const prior = t.versions.filter((v) => v.v < cur.v).sort((a, b) => b.v - a.v)[0]
  if (!prior) return empty
  // 同喂最新事实 → 隔离"本期校准"的纯参数改动(事实驱动的变化由 drivingFact 单列;历史 V 冻结见 timelineTrajectory)
  const curT = valuationTrace(cur, bundle!.facts)
  const priorT = valuationTrace(prior, bundle!.facts)
  if (!curT?.ok || !priorT?.ok) return empty // 无完整恒等式无法 diff

  const priorByOut: Record<string, number> = {}
  const changed: string[] = []
  for (const s of curT.steps) {
    const p = priorT.steps.find((x) => x.out === s.out)
    if (!p) continue
    priorByOut[s.out] = p.base
    if (p.base !== s.base) changed.push(s.out)
  }
  const priorA = new Map(prior.valuation.assumptions.map((a) => [a.key, a]))
  const paramPrior: Record<string, string | number> = {}
  const changedParams = cur.valuation.assumptions
    .filter((a) => {
      const pa = priorA.get(a.key)
      if (pa && String(pa.base) !== String(a.base)) {
        paramPrior[a.key] = pa.base
        return true
      }
      return false
    })
    .map((a) => a.label ?? a.key)

  // 驱动事实 = 触发本版的复查(spawned_v === cur.v)里偏离/破的对账项
  let drivingFact: string | null = null
  const trig = bundle!.timeline.find(
    (e) => e.type === '复查' && (e as Checkpoint).spawned_v === cur.v,
  ) as Checkpoint | undefined
  const brk = trig?.checks.find((c) => c.outcome === '偏离' || c.outcome === '破')
  if (brk) {
    drivingFact =
      `${brk.actual_fact ?? brk.assumption} 实${brk.actual}` +
      (brk.attribution ? ` · ${brk.attribution.type}` : '')
  }
  return { active: changed.length > 0, priorByOut, changed, changedParams, paramPrior, drivingFact }
}

// ===== 时间线轨迹(验证/价值/确信/仓位 走势 · §8.4 时光机顶部条)=====
export interface Trajectory {
  validitySeq: Validity[] // 逐复查 validity(时间序)
  convictionSeq: (Conviction | null)[]
  vSeq: number[] // 各版本 V base(computed,价值轨迹)
  position: number | null // 当前仓位(最近 建/加 weight)
}

export function timelineTrajectory(bundle: CardBundle | null): Trajectory {
  const checks = (bundle?.timeline ?? []).filter((e) => e.type === '复查') as Checkpoint[]
  const vSeq = (bundle?.thesis?.versions ?? []).map((v) => {
    const tr = valuationTrace(v)
    return tr?.ok && tr.V ? tr.V.base : v.valuation.V.base
  })
  let position: number | null = null
  const tl = bundle?.timeline ?? []
  for (let i = tl.length - 1; i >= 0; i--) {
    const e = tl[i]
    if (e.type === '决策' && (e.trade === '建' || e.trade === '加') && e.weight != null) {
      position = e.weight
      break
    }
  }
  return {
    validitySeq: checks.map((c) => c.validity),
    convictionSeq: checks.map((c) => c.conviction ?? null),
    vSeq,
    position,
  }
}

/** 健康度 → emoji(保留)。 */
export function healthEmoji(h: Health): string {
  return h === 'green' ? '🟢' : h === 'yellow' ? '🟡' : h === 'red' ? '🔴' : '⚪'
}
/** gate → emoji(保留)。 */
export function gateEmoji(state: GateState | null): string {
  switch (state) {
    case '通行':
      return '🟢'
    case '警告':
      return '🟡'
    case '节流':
      return '🟠'
    case '否决':
      return '🔴'
    default:
      return '⚪'
  }
}
