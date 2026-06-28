// src/shared/invest/valuation-trace.ts —— shared: 估值恒等式阶梯(参数→中间量→V,纯函数·主/渲共用)
//
// 把 thesis 的 assumptions(逐参数三档)按配模式恒等式逐步算成 V,吐每步中间量 trace,
// 供 UI 渲染"恒等式阶梯"+"事实改参数→沿链重算"(value-chain-rigor §8.3 / §9)。
//   · 三档传导:仅命门(core,即带 logic 的参数)随档动撑区间,支撑参数固定 base
//     (区间=命门赌错范围,不被全参数"完美相关"系统性夸大)。
//   · 五配模式全实现:pe(自上而下)/dcf(终值法)/pb-roe(合理PB)/ddm(戈登)/nav(分部)。
//   · 缺参数 / 经济上无意义(r≤g)→ ok:false + missing[],不臆造(UI 回退显存量 V)。
//
// 允许依赖: ../types/invest(纯类型)   禁止依赖: 任何运行时模块

import type { ValuationMethod, ValuationAssumption, Facts, PredictionAnchor } from '../types/invest'

/** 阶梯参数(逐参数三档;%-单位的值按 /100 折算)。 */
export interface TraceAssumption {
  key: string
  bear: number | string
  base: number | string
  bull: number | string
  unit?: string | null
  /** 命门(core=true)在 bear/bull 间动撑区间;非命门全档取 base。
   *  命门由 logic 派生(派生层传 core=!!logic),引擎只认 core 布尔。
   *  → bear/bull V 只由命门驱动,不被全参数"完美相关"夸大(三档传导严谨化)。 */
  core?: boolean
}

/** 一步中间量(三档)。 */
export interface TraceStep {
  out: string // 中间量名:行业销量/营收/EPS/V…
  expr: string // 人读算式:× 份额 / ÷ 股本
  inputs: string[] // 本步用到的参数 key(重算时定位"哪个参数变了→从哪步起重传")
  bear: number
  base: number
  bull: number
  unit?: string
}

export interface ValuationTrace {
  method: ValuationMethod
  ok: boolean // true=完整恒等式;false=缺参数/经济无意义 → UI 回退显存量 V
  steps: TraceStep[] // 末步 out==='V'
  V: { bear: number; base: number; bull: number } | null
  missing?: string[] // ok=false 时:缺的参数 key 或原因
}

type Band = 'bear' | 'base' | 'bull'
const BANDS: Band[] = ['bear', 'base', 'bull']
type Get = (key: string) => TraceAssumption | undefined

/** 配模式恒等式叶子参数(也供 store validator 校验必备项;nav 分部 key 可变,留空)。 */
export const METHOD_PARAMS: Record<ValuationMethod, string[]> = {
  pe: ['ev_pen', 'mkt_capacity', 'co_share', 'asp', 'net_margin', 'shares', 'pe_central'],
  dcf: ['fcf0', 'fcf_growth', 'wacc', 'term_growth', 'horizon', 'net_debt', 'shares'],
  'pb-roe': ['roe_norm', 'bvps', 'sustain_growth', 'coe'],
  ddm: ['dps0', 'div_growth', 'coe'],
  nav: [], // 分部 key 可变,不固定
}

const toNum = (v: number | string | undefined): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.+-]/g, ''))
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

const round = (n: number, d = 0): number => {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}

/** 取参数某档值;%-单位 /100。命门(high)随档动,非命门固定 base(区间只由命门驱动)。 */
const paramAt = (get: Get, key: string, b: Band): number => {
  const a = get(key)
  if (!a) return NaN
  const band: Band = a.core ? b : 'base'
  const raw = toNum(a[band])
  return a.unit === '%' ? raw / 100 : raw
}

/** 缺参数(不存在或三档任一非有限)。 */
const missingOf = (get: Get, keys: string[]): string[] =>
  keys.filter((k) => {
    const a = get(k)
    return !a || [a.bear, a.base, a.bull].some((x) => !Number.isFinite(toNum(x)))
  })

const bandTriple = (fn: (b: Band) => number) => ({
  bear: fn('bear'),
  base: fn('base'),
  bull: fn('bull'),
})

/** 一步:输出值 + 元信息;三档由 bandFn 各算一次。 */
function step(
  out: string,
  expr: string,
  inputs: string[],
  unit: string,
  bandFn: (b: Band) => number,
): TraceStep {
  return {
    out,
    expr,
    inputs,
    unit,
    bear: bandFn('bear'),
    base: bandFn('base'),
    bull: bandFn('bull'),
  }
}

const fallback = (method: ValuationMethod, missing: string[]): ValuationTrace => ({
  method,
  ok: false,
  steps: [],
  V: null,
  missing,
})

/** pe 自上而下:渗透率×容量→行业销量 ×份额→公司销量 ×单价→营收 ×净利率→净利 ÷股本→EPS ×PE→V。 */
function pePipeline(get: Get): ValuationTrace {
  const missing = missingOf(get, METHOD_PARAMS.pe)
  if (missing.length) return fallback('pe', missing)
  const p = (k: string, b: Band) => paramAt(get, k, b)
  const indSales = (b: Band) => p('ev_pen', b) * p('mkt_capacity', b)
  const coSales = (b: Band) => indSales(b) * p('co_share', b)
  const rev = (b: Band) => coSales(b) * p('asp', b) // 万辆 × 万元 = 亿元
  const ni = (b: Band) => rev(b) * p('net_margin', b)
  const eps = (b: Band) => ni(b) / p('shares', b) // 亿元 ÷ 亿股 = 元
  const v = (b: Band) => eps(b) * p('pe_central', b)
  const steps: TraceStep[] = [
    step('行业销量', '渗透率 × 容量', ['ev_pen', 'mkt_capacity'], '万辆', (b) =>
      round(indSales(b)),
    ),
    step('公司销量', '× 份额', ['co_share'], '万辆', (b) => round(coSales(b))),
    step('营收', '× 单价', ['asp'], '亿', (b) => round(rev(b))),
    step('净利', '× 净利率', ['net_margin'], '亿', (b) => round(ni(b))),
    step('EPS', '÷ 股本', ['shares'], '元', (b) => round(eps(b), 1)),
    step('V', '× PE中枢', ['pe_central'], '¥', (b) => round(v(b))),
  ]
  return { method: 'pe', ok: true, steps, V: bandTriple((b) => round(v(b))) }
}

/** dcf 终值法:Σ FCFₜ/(1+wacc)ᵗ + 终值PV − 净负债 ÷股本 → V(需 wacc>永续g、horizon≥1)。 */
function dcfPipeline(get: Get): ValuationTrace {
  const missing = missingOf(get, METHOD_PARAMS.dcf)
  if (missing.length) return fallback('dcf', missing)
  const p = (k: string, b: Band) => paramAt(get, k, b)
  const n = (b: Band) => Math.round(p('horizon', b))
  if (!BANDS.every((b) => p('wacc', b) > p('term_growth', b) && n(b) >= 1)) {
    return fallback('dcf', ['折现率需>永续增长率·期数≥1'])
  }
  const explicitPV = (b: Band) => {
    const g = p('fcf_growth', b)
    const w = p('wacc', b)
    const f0 = p('fcf0', b)
    let s = 0
    for (let t = 1; t <= n(b); t++) s += (f0 * Math.pow(1 + g, t)) / Math.pow(1 + w, t)
    return s
  }
  const termPV = (b: Band) => {
    const g = p('fcf_growth', b)
    const w = p('wacc', b)
    const gt = p('term_growth', b)
    const fcfN = p('fcf0', b) * Math.pow(1 + g, n(b))
    return (fcfN * (1 + gt)) / (w - gt) / Math.pow(1 + w, n(b))
  }
  const ev = (b: Band) => explicitPV(b) + termPV(b)
  const equity = (b: Band) => ev(b) - p('net_debt', b)
  const v = (b: Band) => equity(b) / p('shares', b)
  const steps: TraceStep[] = [
    step('预测期PV', 'Σ FCFₜ/(1+wacc)ᵗ', ['fcf0', 'fcf_growth', 'wacc', 'horizon'], '亿', (b) =>
      round(explicitPV(b)),
    ),
    step('终值PV', 'FCF_n(1+g∞)/(wacc−g∞) 折现', ['term_growth', 'wacc'], '亿', (b) =>
      round(termPV(b)),
    ),
    step('企业价值', '预测期PV + 终值PV', [], '亿', (b) => round(ev(b))),
    step('股权价值', '− 净负债', ['net_debt'], '亿', (b) => round(equity(b))),
    step('V', '÷ 股本', ['shares'], '¥', (b) => round(v(b), 1)),
  ]
  return { method: 'dcf', ok: true, steps, V: bandTriple((b) => round(v(b), 1)) }
}

/** pb-roe:合理PB=(ROE−g)/(COE−g) → ×BVPS → V(需 COE>可持续g)。 */
function pbRoePipeline(get: Get): ValuationTrace {
  const missing = missingOf(get, METHOD_PARAMS['pb-roe'])
  if (missing.length) return fallback('pb-roe', missing)
  const p = (k: string, b: Band) => paramAt(get, k, b)
  if (!BANDS.every((b) => p('coe', b) > p('sustain_growth', b))) {
    return fallback('pb-roe', ['股权成本需>可持续增长'])
  }
  const pb = (b: Band) =>
    (p('roe_norm', b) - p('sustain_growth', b)) / (p('coe', b) - p('sustain_growth', b))
  const v = (b: Band) => pb(b) * p('bvps', b)
  const steps: TraceStep[] = [
    step('合理PB', '(ROE−g)/(COE−g)', ['roe_norm', 'sustain_growth', 'coe'], 'x', (b) =>
      round(pb(b), 2),
    ),
    step('V', '× BVPS', ['bvps'], '¥', (b) => round(v(b), 1)),
  ]
  return { method: 'pb-roe', ok: true, steps, V: bandTriple((b) => round(v(b), 1)) }
}

/** ddm 戈登增长:DPS×(1+g)/(COE−g) → V(需 COE>股利g)。 */
function ddmPipeline(get: Get): ValuationTrace {
  const missing = missingOf(get, METHOD_PARAMS.ddm)
  if (missing.length) return fallback('ddm', missing)
  const p = (k: string, b: Band) => paramAt(get, k, b)
  if (!BANDS.every((b) => p('coe', b) > p('div_growth', b))) {
    return fallback('ddm', ['股权成本需>股利增长'])
  }
  const v = (b: Band) =>
    (p('dps0', b) * (1 + p('div_growth', b))) / (p('coe', b) - p('div_growth', b))
  const steps: TraceStep[] = [
    step('V', 'DPS×(1+g)/(COE−g)', ['dps0', 'div_growth', 'coe'], '¥', (b) => round(v(b), 1)),
  ]
  return { method: 'ddm', ok: true, steps, V: bandTriple((b) => round(v(b), 1)) }
}

/** nav 分部重估:Σ分部 − 净负债 ÷股本 → V(分部 = 除 net_debt/shares 外的全部参数)。 */
function navPipeline(get: Get, assumptions: TraceAssumption[]): ValuationTrace {
  const segs = assumptions.filter((a) => a.key !== 'net_debt' && a.key !== 'shares')
  const need = missingOf(get, ['shares', ...segs.map((s) => s.key)])
  if (segs.length === 0 || need.length) return fallback('nav', need.length ? need : ['缺分部'])
  const p = (k: string, b: Band) => paramAt(get, k, b)
  const gross = (b: Band) => segs.reduce((s, a) => s + p(a.key, b), 0)
  const netDebt = (b: Band) => (get('net_debt') ? p('net_debt', b) : 0)
  const equity = (b: Band) => gross(b) - netDebt(b)
  const v = (b: Band) => equity(b) / p('shares', b)
  const steps: TraceStep[] = [
    step(
      '毛NAV',
      'Σ分部',
      segs.map((s) => s.key),
      '亿',
      (b) => round(gross(b)),
    ),
    step('股权NAV', '− 净负债', ['net_debt'], '亿', (b) => round(equity(b))),
    step('V', '÷ 股本', ['shares'], '¥', (b) => round(v(b), 1)),
  ]
  return { method: 'nav', ok: true, steps, V: bandTriple((b) => round(v(b), 1)) }
}

/** 估值恒等式阶梯:按 method 跑恒等式,逐参数三档传导,吐 trace。缺参数/经济无意义 → ok:false。 */
export function computeValuationTrace(
  method: ValuationMethod,
  assumptions: TraceAssumption[],
): ValuationTrace {
  const byKey = new Map((assumptions ?? []).map((a) => [a.key, a]))
  const get: Get = (key) => byKey.get(key)
  switch (method) {
    case 'pe':
      return pePipeline(get)
    case 'dcf':
      return dcfPipeline(get)
    case 'pb-roe':
      return pbRoePipeline(get)
    case 'ddm':
      return ddmPipeline(get)
    case 'nav':
      return navPipeline(get, assumptions ?? [])
    default:
      return fallback(method, ['(未知配模式)'])
  }
}

/** facts[key] 最新观测数值(append-only,取末元素);无 → NaN。 */
function latestFactValue(facts: Facts | undefined, key: string | undefined): number {
  const series = key ? facts?.[key]?.series : undefined
  if (!series || series.length === 0) return NaN
  return toNum(series[series.length - 1]?.value)
}

/** facts[key] 在指定时点 as_of 的观测数值(基线锚);未给 as_of 或未命中 → 退回最新;无 → NaN。 */
function factValueAt(
  facts: Facts | undefined,
  key: string | undefined,
  asOf: string | undefined,
): number {
  const series = key ? facts?.[key]?.series : undefined
  if (!series || series.length === 0) return NaN
  if (asOf) {
    const hit = series.find((o) => o.as_of === asOf)
    if (hit) return toNum(hit.value)
  }
  return toNum(series[series.length - 1]?.value)
}

/** 锚取值:when='now' 取最新观测(现值回流)、when='baseline' 取 anchor.as_of 那条(复盘对照·冻结);无 → NaN。 */
export function anchorValue(
  facts: Facts | undefined,
  anchor: PredictionAnchor | undefined,
  when: 'now' | 'baseline' = 'now',
): number {
  if (!anchor) return NaN
  return when === 'baseline'
    ? factValueAt(facts, anchor.fact, anchor.as_of)
    : latestFactValue(facts, anchor.fact)
}

/**
 * 把 thesis 的 assumptions 解析成引擎吃的绝对未来值 TraceAssumption(价值链:逻辑→事实锚→推算)。
 *   · 命门 core = !!logic(支持逻辑的指标)。
 *   · forecast.mode delta/factor:未来值 = 锚应用推测(delta=锚+量 / factor=锚×倍数);
 *     缺锚 → NaN(引擎 missingOf 捕获 → ok:false,不臆造)。
 *   · absolute:forecast.bear/base/bull 直取(技术输入 / 利率 / 倍数 / 常量)。
 *   · 双锚:when='now' 锚取最新事实(V_now 活算回流);when='baseline' 锚取 anchor.as_of(复盘对照·冻结)。
 */
export function resolveForecast(
  assumptions: ValuationAssumption[],
  facts: Facts | undefined,
  when: 'now' | 'baseline' = 'now',
): TraceAssumption[] {
  return (assumptions ?? []).map((a) => {
    const core = !!a.logic
    const unit = a.unit ?? undefined
    const f = a.forecast
    if (!f || f.mode === 'absolute') {
      return {
        key: a.key,
        bear: f?.bear ?? NaN,
        base: f?.base ?? NaN,
        bull: f?.bull ?? NaN,
        unit,
        core,
      }
    }
    const anchor = anchorValue(facts, a.anchor, when)
    const apply = (band: number | string): number => {
      const v = toNum(band)
      if (!Number.isFinite(anchor) || !Number.isFinite(v)) return NaN
      return f.mode === 'delta' ? anchor + v : anchor * v
    }
    return { key: a.key, bear: apply(f.bear), base: apply(f.base), bull: apply(f.bull), unit, core }
  })
}
