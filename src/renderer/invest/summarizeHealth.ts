// src/renderer/invest/summarizeHealth.ts —— renderer: 案卷派生(纯函数,可测)
//
// 案卷 = 决策面(散户层链条 ①逻辑→②估值→③安全边际→④决策)+ 三下钻(专业层)。
// 本文件把 CardBundle 派生成可渲染结构(UI 只读不算价值,见不变量③):
//   · latestCheckpoint / summarizeHealth / latestValidity —— 逻辑健康 + 双向验证态 + gate
//   · currentThesis / coreAssumptions —— 当前逻辑 + 命门(有 logic 的参数)
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
import { parseAsOfMonth, freshnessWindowMonths } from '@shared/invest/freshness'
import {
  computeValuationTrace,
  resolveForecast,
  anchorValue,
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

/** 命门 = 挂了 logic 的参数(支持逻辑的指标)。 */
export function coreAssumptions(snap: ThesisSnapshot | null): ValuationAssumption[] {
  return (snap?.valuation?.assumptions ?? []).filter((a) => !!a.logic)
}

/** 参数推测量 → 一句话(取 forecast.base)。 */
export function projBase(a: ValuationAssumption): string {
  const f = a.forecast
  return f?.base != null ? String(f.base) : f?.bear != null ? `${f.bear}~${f.bull ?? ''}` : '—'
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
  const byKey = new Map((cp?.checks ?? []).map((c) => [c.metric, c]))
  // 估 = 推算后的未来值(命门 forecast 解析成绝对数 + 单位),与 实(最新对账)同量纲可比 —— 不显原始增量
  const resolved = new Map(
    resolveForecast(cur.valuation.assumptions, bundle?.facts, 'now').map((r) => [r.key, r]),
  )
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
    const r = resolved.get(a.key)
    const projected =
      r && Number.isFinite(Number(r.base)) ? `${r.base}${a.unit ?? ''}` : projBase(a)
    return {
      metric: a.label ?? a.key,
      high: true,
      projected,
      actual: chk ? String(chk.actual_value) : undefined,
      conv,
    }
  })
  return { lines, realizedPct: cp?.value_now?.realized_pct ?? null }
}

// ===== B1 逻辑 → 预期(命门:锚 → 估 + 跳变)=====
// 把"逻辑如何变成预期数字"摆上台面:每命门 锚(最新观测)→ 估(forecast 解析后) + 跳变(估−锚)。
// 大跳变 = 预期偏离当前事实很远 → 需强逻辑撑(UI 标黄提示);锚缺失(proj 缺事实)→ 断环标红。
export interface LogicLine {
  key: string
  logic: string // 命门挂的逻辑(为什么这么预期)
  label: string
  unit: string
  anchor: number | null // 锚:最新观测值(预期的事实起点)
  anchorFact?: string // 锚事实 key
  anchorAsOf?: string // 锚事实最新观测时点
  est: number | null // 估:forecast 解析后的 base(代入引擎的预期值)
  jump: number | null // 跳变 = 估 − 锚(预期相对当前事实移动了多少)
  jumpRel: number | null // |跳变| / |锚|(相对幅度;判大跳变)
  bigJump: boolean // 大跳变(相对幅度 > 50%)→ 需强逻辑支撑
  broken: boolean // 锚缺失(proj 模式无最新事实)→ 估值链断,标红
  actual?: string // 实:最新复查对账值(有则显跟踪)
  conv?: '强化' | '持有' | '背离'
  computedWarn: boolean // 命门名像"计算型聚合量"(EPS/净利润)→ 应由上游 营收×净利率÷股本 算出,不应直接预测(软警告)
}

/** 计算型聚合量(应由上游计算得出,不应作命门直接预测/滚前值)。营收/净利率是合法叶子,不在内。 */
const COMPUTED_METRIC_RE = /eps|每股收益|净利润|归母净利/i

/** 锚事实最新观测时点(append-only 取末元素)。 */
function latestAsOf(facts: Facts | undefined, key: string | undefined): string | undefined {
  const series = key ? facts?.[key]?.series : undefined
  return series && series.length > 0 ? series[series.length - 1].as_of : undefined
}

export function coreLogicLines(bundle: CardBundle | null): LogicLine[] {
  const cur = currentThesis(bundle)
  if (!cur) return []
  const facts = bundle?.facts
  const cp = latestCheckpoint(bundle)
  const byMetric = new Map((cp?.checks ?? []).map((c) => [c.metric, c]))
  const resolved = new Map(
    resolveForecast(cur.valuation.assumptions, facts, 'now').map((r) => [r.key, r]),
  )
  return coreAssumptions(cur).map((a) => {
    const unit = a.unit ?? ''
    const isProj = a.forecast?.mode !== 'absolute'
    const anchorRaw = anchorValue(facts, a.anchor, 'now')
    const anchor = Number.isFinite(anchorRaw) ? anchorRaw : null
    const r = resolved.get(a.key)
    const estRaw = r ? Number(r.base) : NaN
    const est = Number.isFinite(estRaw) ? estRaw : null
    // 跳变(估−锚)仅 delta/factor 有意义:est 由锚推导(同一量,跳变=预测对锚的移动)。
    // absolute:est 独立设定、锚仅作"立足事实"(可能异量)→ 不算跳变,免"估3% − 锚1502亿"式无意义减法。
    const derived = a.forecast?.mode === 'delta' || a.forecast?.mode === 'factor'
    const jump = derived && est != null && anchor != null ? round2(est - anchor) : null
    const jumpRel = jump != null && anchor !== 0 && anchor != null ? Math.abs(jump / anchor) : null
    const chk = byMetric.get(a.key)
    const conv: LogicLine['conv'] = chk
      ? chk.outcome === '兑现' || chk.outcome === '超预期'
        ? '强化'
        : chk.outcome === '容差'
          ? '持有'
          : '背离'
      : undefined
    return {
      key: a.key,
      logic: a.logic ?? '',
      label: a.label ?? a.key,
      unit,
      anchor,
      anchorFact: a.anchor?.fact,
      anchorAsOf: latestAsOf(facts, a.anchor?.fact),
      est,
      jump,
      jumpRel,
      bigJump: jumpRel != null && jumpRel > 0.5,
      broken: isProj && anchor == null, // 推算型缺锚 = 链断;absolute 型可无锚(直取)
      actual: chk ? String(chk.actual_value) : undefined,
      conv,
      computedWarn: COMPUTED_METRIC_RE.test(a.key) || COMPUTED_METRIC_RE.test(a.label ?? ''),
    }
  })
}

// ===== 数据新鲜度(as_of 相对今天的月龄;按披露周期 cadence 判过时。now 可注入 → 可测)=====
export interface FactFreshness {
  asOf?: string // 该事实最新观测时点(按 as_of 解析取最大,非数组序)
  ageMonths: number | null // 相对今天的月龄
  stale: boolean // 月龄超该 cadence 新鲜窗 → 过时
}

/** 每条事实:取 series 最新期(parseAsOfMonth 求 max),月龄相对今天,按 cadence 窗判 stale。 */
export function factFreshness(
  facts: Facts | undefined,
  now: Date = new Date(),
): Record<string, FactFreshness> {
  const nowIdx = parseAsOfMonth(now.toISOString().slice(0, 7))
  const out: Record<string, FactFreshness> = {}
  for (const [k, f] of Object.entries(facts ?? {})) {
    let latestIdx: number | null = null
    let latestAsOf: string | undefined
    for (const o of f.series ?? []) {
      const idx = parseAsOfMonth(o.as_of)
      if (idx != null && (latestIdx == null || idx > latestIdx)) {
        latestIdx = idx
        latestAsOf = o.as_of
      }
    }
    const ageMonths = nowIdx != null && latestIdx != null ? nowIdx - latestIdx : null
    const win = freshnessWindowMonths(f)
    out[k] = {
      asOf: latestAsOf,
      ageMonths,
      stale: win != null && ageMonths != null && ageMonths > win,
    }
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
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
    if (a.falsify_if) out.push(a.falsify_if)
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

// ===== 时光机:重建 card(T) —— 把 bundle 切到时点 T,派生函数原样复用 =====
// 历史冻结只读、现在可拨:as_of/at ≤ T 的事实/逻辑版本/时间线才纳入;current 逻辑 = ≤T 最新版。
// 切完的 bundle 喂给上面任何派生(coreLogicLines / valuationTrace / safety / …)即得 T 时刻视图。
export function reconstructCardAt(bundle: CardBundle, t: string): CardBundle {
  // 事实:每 key 的 series 只留 as_of ≤ T(空则丢弃该 key)
  const facts: Facts = {}
  for (const [k, f] of Object.entries(bundle.facts)) {
    const series = f.series.filter((p) => p.as_of <= t)
    if (series.length > 0) facts[k] = { ...f, series }
  }
  // 逻辑:只留 at ≤ T 的版本;current 指向 ≤T 最新版。T 早于建卡 → 无逻辑
  let thesis = bundle.thesis
  if (thesis) {
    const versions = thesis.versions.filter((v) => v.at <= t)
    thesis = versions.length > 0 ? { ...thesis, versions, current: versionAt(versions, t) } : null
  }
  // 时间线:只留 at ≤ T
  const timeline = bundle.timeline.filter((e) => e.at <= t)
  return { ...bundle, facts, thesis, timeline }
}

// ===== 估值恒等式阶梯 + 重算(value-chain-rigor §8.3 / §9)=====

/** 当前/给定逻辑版本的估值 trace(参数→中间量→V);无 valuation → null。 */
export function valuationTrace(snap: ThesisSnapshot | null, facts?: Facts): ValuationTrace | null {
  if (!snap?.valuation) return null
  // 锚(最新事实)→ 推算未来 → 恒等式(命门撑区间·非命门固定 base);forecast 缺锚 → 引擎判缺不臆造。
  const assumps = resolveForecast(snap.valuation.assumptions, facts, 'now')
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
      if (pa && String(pa.forecast.base) !== String(a.forecast.base)) {
        paramPrior[a.key] = pa.forecast.base
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
      `${brk.actual_as_of ?? brk.metric} 实${brk.actual_value}` +
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
