// src/main/invest/compute/macro-clock.ts —— 业务层: 宏观美林时钟定位(确定性)
//
// 把宏观"经济现在几点钟"用美林时钟定位:增长×通胀 → 4 象限(复苏/过热/滞胀/衰退),
// 每象限对应权益态度(重配/标配/回避)+ 利好资产。流动性/政策/外部 做态度微调。
// = 宏观层的确定性评分(对称 公司 8 红灯 / 行业 6 维):agent 喂 5 维指标,定位规则在代码里,
// LLM 不自评"风向恶化"。宏观季度粗调,只驱动总仓位/股债大类,不 micro-gate 个股。
// 设计依据: docs/investment-agent/valuation-methodology.md + 宏观层美林时钟框架。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export type MacroQuadrant = '复苏' | '过热' | '滞胀' | '衰退'
export type EquityStance = '重配' | '标配' | '回避'
export type GrowthLevel = 'high' | 'low'
export type InflationLevel = 'high' | 'low'

export interface MacroClockInput {
  growth?: { pmi?: number; pmi_trend?: 'up' | 'down' | 'flat'; gdp_yoy?: number } // 经济增长
  inflation?: { cpi_yoy?: number; ppi_yoy?: number; ppi_trend?: 'up' | 'down' | 'flat' } // 通胀
  liquidity?: {
    tsf_trend?: 'up' | 'down' | 'flat'
    m2_yoy?: number
    rate?: 'cut' | 'hike' | 'flat'
  } // 流动性
  policy?: { stance?: 'stable_growth' | 'neutral' | 'risk_control' } // 政策(稳增长/防风险)
  external?: {
    fed?: 'easing' | 'tightening' | 'neutral'
    northbound?: 'inflow' | 'outflow' | 'flat'
    cny?: 'strong' | 'weak' | 'flat'
  } // 外部
}

export interface MacroClockResult {
  growth: GrowthLevel | null
  inflation: InflationLevel | null
  quadrant: MacroQuadrant | null
  equity_stance: EquityStance | null
  favored_asset: string | null
  suggested_systemic: 'normal' | 'warning' | 'extreme' | null // 供 regime/gate 联动(总仓位粗调)
  readings: { dim: string; note: string }[]
}

export const MACRO_THRESHOLDS = {
  pmiLine: 50, // 荣枯线
  cpiHigh: 3, // CPI YoY >3% = 通胀偏高
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** 经济增长高/低:PMI 站上荣枯线(且不走低)为主,GDP 辅。 */
function judgeGrowth(g?: MacroClockInput['growth']): GrowthLevel | null {
  if (!g) return null
  if (fin(g.pmi)) {
    if (g.pmi >= MACRO_THRESHOLDS.pmiLine && g.pmi_trend !== 'down') return 'high'
    if (g.pmi < MACRO_THRESHOLDS.pmiLine) return 'low'
    return g.pmi >= MACRO_THRESHOLDS.pmiLine ? 'high' : 'low'
  }
  if (fin(g.gdp_yoy)) return g.gdp_yoy >= 5 ? 'high' : 'low'
  return null
}

/** 通胀高/低:PPI 触底回升/CPI 偏高为"高"(PPI 领先企业盈利)。 */
function judgeInflation(i?: MacroClockInput['inflation']): InflationLevel | null {
  if (!i) return null
  if (i.ppi_trend === 'up') return 'high'
  if (i.ppi_trend === 'down') return 'low'
  if (fin(i.cpi_yoy)) return i.cpi_yoy >= MACRO_THRESHOLDS.cpiHigh ? 'high' : 'low'
  if (fin(i.ppi_yoy)) return i.ppi_yoy > 0 ? 'high' : 'low'
  return null
}

const QUADRANT: Record<string, { q: MacroQuadrant; asset: string; stance: EquityStance }> = {
  'high|low': { q: '复苏', asset: '股票', stance: '重配' },
  'high|high': { q: '过热', asset: '商品/周期', stance: '标配' },
  'low|high': { q: '滞胀', asset: '现金', stance: '回避' },
  'low|low': { q: '衰退', asset: '债券', stance: '回避' },
}

const stanceUp = (s: EquityStance): EquityStance => (s === '回避' ? '标配' : '重配')
const stanceDown = (s: EquityStance): EquityStance => (s === '重配' ? '标配' : '回避')

export function computeMacroClock(input: MacroClockInput): MacroClockResult {
  const growth = judgeGrowth(input.growth)
  const inflation = judgeInflation(input.inflation)
  const readings: { dim: string; note: string }[] = []

  if (input.growth && (fin(input.growth.pmi) || fin(input.growth.gdp_yoy))) {
    readings.push({
      dim: '增长',
      note: fin(input.growth.pmi)
        ? `PMI ${input.growth.pmi}${input.growth.pmi >= 50 ? ' 站上荣枯线' : ' 荣枯线下'}`
        : `GDP ${input.growth.gdp_yoy}%`,
    })
  }
  if (input.inflation && (input.inflation.ppi_trend || fin(input.inflation.cpi_yoy))) {
    readings.push({
      dim: '通胀',
      note: input.inflation.ppi_trend
        ? `PPI ${input.inflation.ppi_trend === 'up' ? '回升' : input.inflation.ppi_trend === 'down' ? '下行' : '走平'}`
        : `CPI ${input.inflation.cpi_yoy}%`,
    })
  }

  // 定位象限
  let quadrant: MacroQuadrant | null = null
  let favored_asset: string | null = null
  let stance: EquityStance | null = null
  if (growth && inflation) {
    const hit = QUADRANT[`${growth}|${inflation}`]
    quadrant = hit.q
    favored_asset = hit.asset
    stance = hit.stance
  }

  // 流动性/政策/外部 → 态度微调(框架:外部宽松+北向流入=利好风险资产)
  let loose = 0
  if (input.liquidity) {
    if (input.liquidity.tsf_trend === 'up' || input.liquidity.rate === 'cut') {
      loose++
      readings.push({ dim: '流动性', note: '社融升/降息,偏宽松' })
    } else if (input.liquidity.tsf_trend === 'down' || input.liquidity.rate === 'hike') {
      loose--
      readings.push({ dim: '流动性', note: '社融降/加息,偏紧' })
    }
  }
  if (input.policy?.stance) {
    if (input.policy.stance === 'stable_growth') {
      loose++
      readings.push({ dim: '政策', note: '定调稳增长' })
    } else if (input.policy.stance === 'risk_control') {
      loose--
      readings.push({ dim: '政策', note: '定调防风险' })
    }
  }
  if (input.external) {
    const e = input.external
    if (e.fed === 'easing' || e.northbound === 'inflow') {
      loose++
      readings.push({ dim: '外部', note: '美联储宽松/北向流入,利好风险资产' })
    } else if (e.fed === 'tightening' || e.northbound === 'outflow') {
      loose--
      readings.push({ dim: '外部', note: '美联储收紧/北向流出,压风险资产' })
    }
  }

  if (stance) {
    if (loose >= 2) stance = stanceUp(stance)
    else if (loose <= -2) stance = stanceDown(stance)
  }

  // 总仓位联动:权益态度 → systemic(回避=warning,过热兼顾=normal)
  const suggested_systemic: MacroClockResult['suggested_systemic'] =
    quadrant === null
      ? null
      : quadrant === '滞胀'
        ? 'warning'
        : stance === '回避'
          ? 'warning'
          : 'normal'

  return {
    growth,
    inflation,
    quadrant,
    equity_stance: stance,
    favored_asset,
    suggested_systemic,
    readings,
  }
}
