// src/main/invest/compute/industry-score.ts —— 业务层: 行业景气 6 维评分(确定性)
//
// 把"行业景气度"拆成 6 个可打分维度(需求/供给/价格库存/格局/政策/估值),按明确的
// 利好/利空信号规则,确定性地给每维 good/bad/neutral + 汇总景气方向。
// = 行业层的"8 红灯":agent 只喂归一化的维度输入,信号规则在代码里,LLM 不自评"景气不错"。
// 设计依据: docs/investment-agent/valuation-methodology.md + 产业层 6 维框架。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export type IndustrySignal = 'good' | 'bad' | 'neutral'

/** 6 维原始输入(数值维给数,定性维 agent 归类成枚举)。缺的维度跳过不评。 */
export interface IndustryScoreInput {
  demand?: { penetration_pct?: number; growth_pct?: number } // 需求/空间:渗透率、行业增速
  supply?: {
    capacity_util_pct?: number
    capex_phase?: 'clearing' | 'restrained' | 'expanding' | 'overcapacity'
  } // 供给:产能利用率、资本开支周期
  price_inventory?: {
    price_trend?: 'up' | 'flat' | 'down'
    inventory?: 'active_restock' | 'passive_buildup' | 'destock' | 'neutral'
  } // 价格/库存:提价/价格战、主动补库/被动累库
  structure?: {
    concentration_trend?: 'rising' | 'flat' | 'fragmenting'
    leader_share_trend?: 'up' | 'flat' | 'down'
  } // 格局:集中度、龙头份额
  policy?: { stance?: 'support' | 'neutral' | 'suppress' } // 政策:扶持/集采打压
  valuation?: { pe_pb_percentile?: number } // 估值:行业 PE/PB 历史分位(0~100)
}

export interface IndustryDimResult {
  dim: '需求' | '供给' | '价格库存' | '格局' | '政策' | '估值'
  signal: IndustrySignal
  note: string
}

export interface IndustryScoreResult {
  dimensions: IndustryDimResult[] // 仅含提供了输入的维度
  good: number
  bad: number
  overall: 'up' | 'flat' | 'down' | null // null = 无任何维度输入
}

/** 阈值(可覆盖)。数值维用阈值,定性维用枚举映射。 */
export const INDUSTRY_THRESHOLDS = {
  penetrationLow: 30, // 渗透率 <30% = 低(有空间)
  growthFast: 15, // 增速 >15% = 快
  capacityTight: 90, // 产能利用率 >90% = 紧(供给偏好)
  capacityLoose: 70, // <70% = 松(供给过剩)
  percentileLow: 30, // 估值分位 <30 = 低
  percentileHigh: 70, // >70 = 高(透支)
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function computeIndustryScore(
  input: IndustryScoreInput,
  th = INDUSTRY_THRESHOLDS,
): IndustryScoreResult {
  const dims: IndustryDimResult[] = []

  // 需求/空间:增速转负=利空;低渗透+高增速=利好
  if (input.demand && (fin(input.demand.growth_pct) || fin(input.demand.penetration_pct))) {
    const g = input.demand.growth_pct
    const p = input.demand.penetration_pct
    let signal: IndustrySignal = 'neutral'
    let note = ''
    if (fin(g) && g < 0) {
      signal = 'bad'
      note = `增速转负(${g}%),需求见顶`
    } else if (fin(g) && g >= th.growthFast) {
      signal = 'good'
      note = `增速快(${g}%)${fin(p) && p < th.penetrationLow ? ` + 低渗透(${p}%),空间大` : ''}`
    } else if (fin(p) && p >= 70) {
      signal = 'neutral'
      note = `渗透率高(${p}%),空间受限`
    } else {
      note = fin(g) ? `增速 ${g}%,平稳` : `渗透率 ${p}%`
    }
    dims.push({ dim: '需求', signal, note })
  }

  // 供给:产能出清/扩产克制=利好;过剩/疯狂扩产=利空
  if (input.supply && (input.supply.capex_phase || fin(input.supply.capacity_util_pct))) {
    const phase = input.supply.capex_phase
    const u = input.supply.capacity_util_pct
    let signal: IndustrySignal = 'neutral'
    let note = ''
    if (phase === 'overcapacity' || (fin(u) && u < th.capacityLoose)) {
      signal = 'bad'
      note = phase === 'overcapacity' ? '产能过剩' : `产能利用率低(${u}%)`
    } else if (phase === 'clearing' || phase === 'restrained' || (fin(u) && u > th.capacityTight)) {
      signal = 'good'
      note =
        phase === 'clearing'
          ? '产能出清'
          : phase === 'restrained'
            ? '扩产克制'
            : `产能利用率高(${u}%)`
    } else {
      note = phase === 'expanding' ? '在扩产(留意是否过度)' : `产能利用率 ${u}%`
    }
    dims.push({ dim: '供给', signal, note })
  }

  // 价格/库存:提价+主动补库=利好;价格战/被动累库=利空
  if (
    input.price_inventory &&
    (input.price_inventory.price_trend || input.price_inventory.inventory)
  ) {
    const price = input.price_inventory.price_trend
    const inv = input.price_inventory.inventory
    let signal: IndustrySignal = 'neutral'
    let note = ''
    if (price === 'down' || inv === 'passive_buildup') {
      signal = 'bad'
      note = price === 'down' ? '价格战' : '被动累库'
    } else if (price === 'up' && (inv === 'active_restock' || inv === 'destock')) {
      signal = 'good'
      note = '提价 + 主动补库/去库'
    } else {
      note = `价格${price ?? '?'}/库存${inv ?? '?'}`
    }
    dims.push({ dim: '价格库存', signal, note })
  }

  // 格局:持续向头部集中=利好;分散/内卷=利空
  if (
    input.structure &&
    (input.structure.concentration_trend || input.structure.leader_share_trend)
  ) {
    const c = input.structure.concentration_trend
    const s = input.structure.leader_share_trend
    let signal: IndustrySignal = 'neutral'
    let note = ''
    if (c === 'fragmenting' || s === 'down') {
      signal = 'bad'
      note = c === 'fragmenting' ? '格局分散/内卷' : '龙头份额下滑'
    } else if (c === 'rising' || s === 'up') {
      signal = 'good'
      note = '向头部集中'
    } else {
      note = '格局平稳'
    }
    dims.push({ dim: '格局', signal, note })
  }

  // 政策:扶持/补贴=利好;集采/限制/打压=利空
  if (input.policy?.stance) {
    const st = input.policy.stance
    dims.push({
      dim: '政策',
      signal: st === 'support' ? 'good' : st === 'suppress' ? 'bad' : 'neutral',
      note: st === 'support' ? '扶持/补贴' : st === 'suppress' ? '集采/限制/打压' : '政策中性',
    })
  }

  // 估值:行业 PE/PB 低分位=利好;高分位=利空(已透支)
  if (input.valuation && fin(input.valuation.pe_pb_percentile)) {
    const pct = input.valuation.pe_pb_percentile
    let signal: IndustrySignal = 'neutral'
    if (pct < th.percentileLow) signal = 'good'
    else if (pct > th.percentileHigh) signal = 'bad'
    dims.push({
      dim: '估值',
      signal,
      note:
        signal === 'good'
          ? `低分位(${pct}%)`
          : signal === 'bad'
            ? `高分位(${pct}%),已透支`
            : `分位 ${pct}%`,
    })
  }

  const good = dims.filter((d) => d.signal === 'good').length
  const bad = dims.filter((d) => d.signal === 'bad').length
  const overall: IndustryScoreResult['overall'] =
    dims.length === 0 ? null : good > bad ? 'up' : bad > good ? 'down' : 'flat'

  return { dimensions: dims, good, bad, overall }
}
