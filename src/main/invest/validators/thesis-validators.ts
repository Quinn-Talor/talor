// src/main/invest/validators/thesis-validators.ts —— 业务层: 立论·逐参数不变量校验器链(注册式,OCP)
//
// 从 store.addThesisVersion 的 per-assumption 内联检查抽出为注册链:新不变量 = 加一个 validator(扩展),
// 不改核心方法。顺序敏感(与原内联逐条一致),throw 于首个不满足的 validator。
// 快照级检查(challenge/assumptions/hasCore/stepChain/margin)+ 计算冻结 V 仍在 store(非逐参数,稳定,不入链)。
//
// 允许依赖: shared/types / shared/invest/freshness / ../store(CardValidationError,运行时用,循环安全)
// 禁止依赖: ipc/* / mcp/*
import type { Facts, FactObservation, ValuationAssumption } from '../../../shared/types/invest'
import { CardValidationError } from '../store'
import { parseAsOfMonth, cadenceOf, freshnessWindowMonths } from '../../../shared/invest/freshness'

/** 逐参数校验上下文(addThesisVersion 每个 assumption 构造一次)。 */
export interface AssumptionCtx {
  a: ValuationAssumption
  name: string // a.label ?? a.key
  isCore: boolean // !!(a.logic && a.logic.trim())
  facts: Facts
  factKeys: Set<string>
  now: () => Date // 注入时钟(新鲜度闸)
}

/** 单一不变量校验单元;违反则 throw CardValidationError。 */
export interface AssumptionValidator {
  code: string // 主错误码(文档用;个别 validator 可能抛多个相关码)
  validate(ctx: AssumptionCtx): void
}

/** "key@as_of" → key(与 store.factRefKey 同,内联避免循环导入面扩大)。 */
const refKey = (ref: string): string => String(ref).split('@')[0].trim()

const forecastMode: AssumptionValidator = {
  code: 'FORECAST_NO_MODE',
  validate({ a, name }) {
    const f = a.forecast
    if (!f || (f.mode !== 'delta' && f.mode !== 'factor' && f.mode !== 'absolute')) {
      throw new CardValidationError('FORECAST_NO_MODE', `参数「${name}」无 forecast.mode`)
    }
  },
}

const coreForecastDerived: AssumptionValidator = {
  code: 'CORE_FORECAST_NOT_DERIVED',
  validate({ a, name, isCore }) {
    // Guard 2a(命门基于事实):命门须 delta/factor(锚事实值推导);禁 absolute(凭空给数)。
    if (isCore && a.forecast.mode === 'absolute') {
      throw new CardValidationError(
        'CORE_FORECAST_NOT_DERIVED',
        `命门「${name}」用了 absolute(凭空给数)。命门预估须基于锚事实推导(delta=锚+增量 / factor=锚×倍数);纯常量请作支撑(去掉 logic)。`,
      )
    }
  },
}

const anchorReferences: AssumptionValidator = {
  code: 'ASSUMPTION_NO_ANCHOR',
  validate({ a, name, isCore, factKeys }) {
    // 不变量⑦:命门 / delta / factor 必立足锚事实(anchor.fact 指向已有 facts)
    const needsAnchor = isCore || a.forecast.mode === 'delta' || a.forecast.mode === 'factor'
    if (!needsAnchor) return
    if (!a.anchor?.fact || a.anchor.fact.trim() === '') {
      throw new CardValidationError(
        'ASSUMPTION_NO_ANCHOR',
        `参数「${name}」无 anchor.fact(预测须立足事实)`,
      )
    }
    if (!factKeys.has(a.anchor.fact)) {
      throw new CardValidationError(
        'FACT_REFERENCED_MISSING',
        `参数「${name}」锚事实「${a.anchor.fact}」不在 facts(先 addFacts)`,
      )
    }
  },
}

const anchorBaseline: AssumptionValidator = {
  code: 'ANCHOR_NO_ASOF',
  validate({ a, name, facts }) {
    // delta/factor 须有基线时点,且该观测在序列中(对照复盘不漂的起点)
    if (a.forecast.mode !== 'delta' && a.forecast.mode !== 'factor') return
    const asOf = a.anchor?.as_of
    if (!asOf || asOf.trim() === '') {
      throw new CardValidationError(
        'ANCHOR_NO_ASOF',
        `参数「${name}」forecast=${a.forecast.mode} 须 anchor.as_of(基线时点)`,
      )
    }
    if (!(facts[a.anchor!.fact]?.series ?? []).some((o) => o.as_of === asOf)) {
      throw new CardValidationError(
        'ANCHOR_ASOF_MISSING',
        `参数「${name}」基线 ${a.anchor!.fact}@${asOf} 不在 facts 观测序列`,
      )
    }
  },
}

const anchorUnitMatch: AssumptionValidator = {
  code: 'ANCHOR_UNIT_MISMATCH',
  validate({ a, name, facts }) {
    // Guard 2b(锚同量纲):delta/factor 参数与锚必须同口径(单位一致)。
    if (a.forecast.mode !== 'delta' && a.forecast.mode !== 'factor') return
    const factUnit = facts[a.anchor!.fact]?.unit ?? undefined
    const paramUnit = a.unit ?? undefined
    if (!paramUnit || !factUnit || paramUnit !== factUnit) {
      throw new CardValidationError(
        'ANCHOR_UNIT_MISMATCH',
        `参数「${name}」(单位 ${paramUnit ?? '∅'})与锚事实「${a.anchor!.fact}」(单位 ${factUnit ?? '∅'})量纲不一致 — delta/factor 推算要求同口径(锚应挂同量纲事实)。`,
      )
    }
  },
}

const coreVerifyPresent: AssumptionValidator = {
  code: 'CORE_NO_VERIFY',
  validate({ a, name, isCore }) {
    if (!isCore) return
    if (!Array.isArray(a.verify) || a.verify.length === 0) {
      throw new CardValidationError('CORE_NO_VERIFY', `命门「${name}」无 verify(验收映射)`)
    }
  },
}

const effTier = (o: FactObservation): 'T1' | 'T2' | 'T3' | 'compute' =>
  o.provenance?.method === 'fetch'
    ? (o.tier ?? 'T2')
    : o.provenance?.method === 'compute'
      ? 'compute'
      : 'T3'

const coreAnchorTrusted: AssumptionValidator = {
  code: 'ANCHOR_UNTRUSTED',
  validate({ a, name, isCore, facts }) {
    // 命门锚可信硬闸(不采信自报 tier):受信取数(fetch T1/T2)单条即可锚;
    // 手填/compute(effTier T3/compute)须同点 ≥2 权威源交叉。grandfather 已移除。
    if (!isCore) return
    const anchorSeries = facts[a.anchor!.fact]?.series ?? []
    const anchorObs = a.anchor?.as_of
      ? anchorSeries.filter((o) => o.as_of === a.anchor!.as_of)
      : anchorSeries
    const effTiers = anchorObs.map(effTier)
    const srcCount = new Set(anchorObs.map((o) => o.source)).size
    const hasHigh = effTiers.includes('T1') || effTiers.includes('T2')
    const anyLow = effTiers.includes('T3') || effTiers.includes('compute')
    if (anyLow && !hasHigh && srcCount < 2) {
      throw new CardValidationError(
        'ANCHOR_UNTRUSTED',
        `命门「${name}」锚事实「${a.anchor!.fact}@${a.anchor?.as_of ?? '*'}」不可信:手填/低级来源须经受信取数(fetch_metric→T1/T2)或同点 ≥2 权威源交叉。`,
      )
    }
  },
}

const coreAnchorFresh: AssumptionValidator = {
  code: 'STALE_ANCHOR',
  validate({ a, name, isCore, facts, now }) {
    // 新鲜度硬闸(只认 as_of·按 cadence 分级):命门锚须 series 最新期 + 最新期在披露窗内。
    if (!isCore) return
    const anchorSeries = facts[a.anchor!.fact]?.series ?? []
    const freshIdx = anchorSeries
      .map((o) => parseAsOfMonth(o.as_of))
      .filter((x): x is number => x != null)
    if (freshIdx.length === 0) return
    const latestIdx = Math.max(...freshIdx)
    const anchorIdx = parseAsOfMonth(a.anchor?.as_of ?? '')
    if (anchorIdx == null || anchorIdx < latestIdx) {
      throw new CardValidationError(
        'ANCHOR_NOT_LATEST',
        `命门「${name}」锚 ${a.anchor!.fact}@${a.anchor?.as_of ?? '*'} 非最新期(series 有更晚观测),命门须锚最新`,
      )
    }
    const anchorFact = facts[a.anchor!.fact]
    const win = freshnessWindowMonths(anchorFact)
    const nowIdx = parseAsOfMonth(now().toISOString().slice(0, 7))
    if (win != null && nowIdx != null && nowIdx - latestIdx > win) {
      throw new CardValidationError(
        'STALE_ANCHOR',
        `命门「${name}」锚最新期 ${a.anchor?.as_of} 距今 ${nowIdx - latestIdx} 月 > ${cadenceOf(anchorFact)} 窗 ${win} 月,过时;取最新一期再立论`,
      )
    }
  },
}

const verifyRefsExist: AssumptionValidator = {
  code: 'FACT_REFERENCED_MISSING',
  validate({ a, name, factKeys }) {
    for (const vh of a.verify ?? []) {
      if (!factKeys.has(refKey(vh.fact))) {
        throw new CardValidationError(
          'FACT_REFERENCED_MISSING',
          `参数「${name}」验证事实「${vh.fact}」不在 facts`,
        )
      }
    }
  },
}

/**
 * 逐参数校验链(顺序敏感,与原 addThesisVersion 内联逐条一致)。
 * 新增逐参数不变量(如 C 阶段 ANCHOR_MUST_FETCH / sanity / staler-period)→ 加进此数组(扩展,不改核心)。
 */
export const ASSUMPTION_VALIDATORS: readonly AssumptionValidator[] = [
  forecastMode,
  coreForecastDerived,
  anchorReferences,
  anchorBaseline,
  anchorUnitMatch,
  coreVerifyPresent,
  coreAnchorTrusted,
  coreAnchorFresh,
  verifyRefsExist,
]
