// src/shared/invest/freshness.ts —— 事实新鲜度(只认数据披露时点 as_of;按披露周期 cadence 分级)。
// main(store 命门锚闸)↔ renderer(factFreshness)共用。纯函数,无副作用/无时钟(now 由调用方传)。
import type { Cadence } from '../types/invest'

/** as_of → 绝对月序号(year*12 + month0);无法解析 → null。
 *  支持:2026-03 / 2026-03-31 / 2026-Q2 / 2026 / 2026-annual。 */
export function parseAsOfMonth(asOf: string): number | null {
  const s = (asOf ?? '').trim()
  let m = /^(\d{4})-(0[1-9]|1[0-2])(-\d{2})?$/.exec(s)
  if (m) return Number(m[1]) * 12 + (Number(m[2]) - 1)
  m = /^(\d{4})-?[Qq]([1-4])$/.exec(s)
  if (m) return Number(m[1]) * 12 + (Number(m[2]) * 3 - 1) // Qn → 季末月(idx)
  m = /^(\d{4})(-?(annual|年报|全年))?$/.exec(s)
  if (m) return Number(m[1]) * 12 + 11 // 年/年报 → 当年 12 月
  return null
}

export function monthsBetween(nowIdx: number, asOfIdx: number): number {
  return nowIdx - asOfIdx
}

/** cadence → 新鲜窗(月);null = 不设绝对新鲜闸。窗 = 一个披露周期 + 最大披露滞后。 */
export const FRESHNESS_WINDOW_MONTHS: Record<Cadence, number | null> = {
  daily: 1, // 月粒度近似(命门极少锚日频;日精度见 DEFERRED)
  monthly: 2,
  quarterly: 5, // 1 季 + 滞后(含年报次年 4 月底)
  annual: 16, // 1 年 + 滞后
  irregular: null, // 事件驱动,不闸
}

type CadenceInput = { cadence?: Cadence; level?: string; series?: { as_of: string }[] }

/** 认准披露周期:显式 cadence 优先 → 从 as_of 格式/level 推断 → 保守 annual(窗最宽,不误杀)。 */
export function cadenceOf(fact: CadenceInput): Cadence {
  if (fact.cadence) return fact.cadence
  const asofs = (fact.series ?? []).map((s) => (s.as_of ?? '').trim())
  if (asofs.some((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))) return 'daily'
  if (asofs.some((a) => /^\d{4}-?[Qq][1-4]$/.test(a))) return 'quarterly'
  const ym = asofs
    .map((a) => /^(\d{4})-(0[1-9]|1[0-2])$/.exec(a))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => Number(m[2]))
  if (ym.length > 0) {
    // ≥2 观测且全落季末月 = 季度节奏的证据;单条季末月不足判(靠 level 兜底,避免月度数据误判季度)
    if (ym.length >= 2 && ym.every((mo) => mo === 3 || mo === 6 || mo === 9 || mo === 12))
      return 'quarterly'
    if (fact.level === 'company') return 'quarterly'
    if (fact.level === 'macro') return 'monthly'
    return 'monthly'
  }
  if (asofs.some((a) => /^\d{4}(-?(annual|年报|全年))?$/.test(a))) return 'annual'
  return 'annual'
}

/** 该 fact 的新鲜窗(月);null = 不闸。 */
export function freshnessWindowMonths(fact: CadenceInput): number | null {
  return FRESHNESS_WINDOW_MONTHS[cadenceOf(fact)]
}
