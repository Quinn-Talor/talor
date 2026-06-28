// src/main/invest/compute/decision.ts —— 业务层: 决策硬门(质地×估值矩阵 + 仓位,确定性)
//
// 散户"投资纪律外骨骼":把"好公司 × 好价格"四象限和"仓位由最大亏损反推"写成代码硬门,
// 不靠盘感。质地(过没过资格赛 + ROE/护城河)与估值(安全边际是否达标)交叉 → 买/等/弃。
// 仓位 = 单笔风险预算 ÷ 最大可承受亏损(止损位),亏得越多仓位越小。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export type Quality = 'good' | 'fair' | 'poor'
export type ValuationState = 'cheap' | 'fair' | 'expensive'
export type MatrixCell = '好公司好价格' | '好公司贵' | '价值陷阱' | '远离'
export type Action = '买' | '等' | '弃'

export interface DecisionInput {
  quality: Quality // 质地:good=过资格赛+宽护城河;fair=一般;poor=没护城河/有瑕疵
  valuation_state: ValuationState // 估值:由安全边际/反向DCF 给(cheap=有安全边际)
  max_loss_pct: number // 最大可承受亏损(到止损位的跌幅 %,如 20)
  risk_per_trade_pct?: number // 单笔愿赌的组合风险预算(%,默认 2)
  position_cap_pct?: number // 单标的仓位上限(%,默认 10,卫星仓纪律)
}

export interface DecisionResult {
  matrix_cell: MatrixCell
  action: Action
  suggested_position_pct: number | null // 反推建议仓位;max_loss 非正 → null
  reason: string
}

/** 质地 × 估值 → 四象限 + 动作。好质地是前提:质地差无论便宜与否都不买(避开价值陷阱)。 */
function classify(
  q: Quality,
  v: ValuationState,
): { cell: MatrixCell; action: Action; reason: string } {
  if (q === 'good') {
    if (v === 'cheap') return { cell: '好公司好价格', action: '买', reason: '好质地 + 有安全边际' }
    return { cell: '好公司贵', action: '等', reason: '好质地但价格不便宜,等回调/等业绩消化估值' }
  }
  // 质地一般/差:便宜也可能是价值陷阱,贵则远离
  if (v === 'cheap')
    return { cell: '价值陷阱', action: '弃', reason: '便宜但质地不过关,警惕价值陷阱' }
  return { cell: '远离', action: '弃', reason: '质地差且不便宜' }
}

/**
 * 决策硬门。
 * 仓位反推:position = risk_per_trade ÷ (max_loss/100),即"亏到止损位只损失风险预算"。
 * 受 position_cap 上限约束;只有 action=买 才给正仓位(等/弃 → 0,不建仓);max_loss≤0 → null(止损位无意义)。
 */
export function computeDecision(input: DecisionInput): DecisionResult {
  const riskBudget = input.risk_per_trade_pct ?? 2
  const cap = input.position_cap_pct ?? 10
  const { cell, action, reason } = classify(input.quality, input.valuation_state)

  let suggested_position_pct: number | null
  if (action !== '买') {
    suggested_position_pct = 0 // 等/弃 都不建仓
  } else if (!Number.isFinite(input.max_loss_pct) || input.max_loss_pct <= 0) {
    suggested_position_pct = null
  } else {
    const raw = (riskBudget / input.max_loss_pct) * 100
    suggested_position_pct = Math.min(cap, Math.round(raw * 10) / 10)
  }

  return { matrix_cell: cell, action, suggested_position_pct, reason }
}
