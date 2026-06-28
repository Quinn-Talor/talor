// src/main/invest/compute/valuation.ts —— 业务层: 正向三情景估值(确定性)
//
// 价值=f(假设) 的"组合"算子:把每情景的输入(EPS×PE 或 DCF 参数)算成内在价值,
// 再按概率加权得期望。**立足点(EPS/PE 怎么来)由 agent 填,数值组合由本函数确定性算**。
// 与 reverse-dcf(现价反推隐含增速)互补:reverse 给市场隐含,本函数正向给我方价值。
// 设计依据: docs/investment-agent/card-logic-design.md(价值分析反向优先) + mvp-design §8.2。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export type ValuationMethod = 'pe' | 'dcf' | 'pb-roe' | 'ddm' | 'nav'

/**
 * 单情景输入。按 method 取不同子集(配业务选模型,赚什么钱决定怎么估):
 *   pe     成长/拐点 → {eps,pe}
 *   dcf    现金流清晰 → {eps,g,exitPe,horizonYears,discount}(终值法,与 reverseDcf 同闭式)
 *   pb-roe 重资产/金融 → {bvps,roe,g,discount}(合理PB=(ROE−g)/(r−g))或直接 {bvps,pb}
 *   ddm    高分红/稳定 → {dps,g,discount}(戈登增长:D₁/(r−g))
 *   nav    资源/控股/地产 → {navps,premium?}(重估净资产 ± 溢价/折价)
 */
export interface ScenarioInput {
  label: string
  prob: number
  // —— method = 'pe' ——
  eps?: number
  pe?: number
  // —— method = 'dcf'(终值法, 与 reverseDcf 同闭式)——
  g?: number
  exitPe?: number
  horizonYears?: number
  discount?: number
  // —— method = 'pb-roe' ——
  bvps?: number // 每股净资产
  roe?: number // 可持续 ROE(小数, 如 0.18)
  pb?: number // 目标 PB(给定则直接 bvps×pb,跳过 ROE 折算)
  // —— method = 'ddm'(戈登增长)——
  dps?: number // 当期每股分红
  // —— method = 'nav' ——
  navps?: number // 每股重估净资产
  premium?: number // 溢价(+)/折价(−),小数,如 -0.2 表示 8 折
}

export interface ValuationInput {
  method: ValuationMethod
  scenarios: ScenarioInput[]
}

export interface ScenarioValue {
  label: string
  prob: number
  value: number | null // 数据不足 → null(绝不臆造)
}

export interface ValuationResult {
  scenarios: ScenarioValue[]
  expected: number | null // 概率加权期望(全情景可算且 prob 合法时);否则 null
}

const finite = (...xs: Array<number | undefined>): boolean =>
  xs.every((x) => typeof x === 'number' && Number.isFinite(x))

/** 单情景内在价值,按 method 选闭式。数据不足或经济上无意义(如 r≤g)→ null,绝不臆造。 */
function scenarioValue(method: ValuationMethod, s: ScenarioInput): number | null {
  if (method === 'pe') {
    if (!finite(s.eps, s.pe)) return null
    return (s.eps as number) * (s.pe as number)
  }
  if (method === 'pb-roe') {
    if (!finite(s.bvps) || (s.bvps as number) <= 0) return null
    // 给定目标 PB → 直接 bvps×pb;否则用 ROE 折算合理 PB=(ROE−g)/(r−g)
    if (finite(s.pb)) return (s.bvps as number) * (s.pb as number)
    if (!finite(s.roe, s.g, s.discount)) return null
    const r = s.discount as number
    const g = s.g as number
    if (r <= g) return null // 永续增长不能 ≥ 折现率
    const justifiedPb = ((s.roe as number) - g) / (r - g)
    if (justifiedPb <= 0) return null
    return (s.bvps as number) * justifiedPb
  }
  if (method === 'ddm') {
    // 戈登增长:价值 = D₁/(r−g) = dps·(1+g)/(r−g)
    if (!finite(s.dps, s.g, s.discount)) return null
    const r = s.discount as number
    const g = s.g as number
    if ((s.dps as number) <= 0 || r <= g) return null
    return ((s.dps as number) * (1 + g)) / (r - g)
  }
  if (method === 'nav') {
    if (!finite(s.navps) || (s.navps as number) <= 0) return null
    const premium = finite(s.premium) ? (s.premium as number) : 0
    return (s.navps as number) * (1 + premium)
  }
  // dcf 终值法(忽略期间分红,与 reverse-dcf 对称)
  const { eps, g, exitPe, horizonYears: n, discount } = s
  if (!finite(eps, g, exitPe, n, discount)) return null
  if ((eps as number) <= 0 || (exitPe as number) <= 0 || (n as number) <= 0) return null
  return (
    ((eps as number) * Math.pow(1 + (g as number), n as number) * (exitPe as number)) /
    Math.pow(1 + (discount as number), n as number)
  )
}

/**
 * 三情景估值 + 概率加权期望。
 * 期望仅在【全部情景可算 + prob 合法(≥0 且总和>0)】时给出,按 prob 之和归一(容忍未严格 sum=1)。
 * 任一情景缺数据 → 该情景 value=null,expected=null(不在残缺数据上拍期望)。
 */
export function computeValuation(input: ValuationInput): ValuationResult {
  const scenarios: ScenarioValue[] = (input.scenarios ?? []).map((s) => ({
    label: s.label,
    prob: s.prob,
    value: scenarioValue(input.method, s),
  }))
  const allValuable =
    scenarios.length > 0 &&
    scenarios.every((s) => s.value !== null && Number.isFinite(s.prob) && s.prob >= 0)
  const probSum = scenarios.reduce((a, s) => a + (Number.isFinite(s.prob) ? s.prob : 0), 0)
  const expected =
    allValuable && probSum > 0
      ? scenarios.reduce((a, s) => a + s.prob * (s.value as number), 0) / probSum
      : null
  return { scenarios, expected }
}
