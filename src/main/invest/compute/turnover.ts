// src/main/invest/compute/turnover.ts —— 业务层: 周转天数(确定性)
//
// 存货/应收周转天数 = 期初期末均值 ÷ 基数 × 天数。存货基数=营业成本,应收基数=营收。
// 周转放缓(天数↑)是先行预警:存货↑+周转↓=滞销;应收↑+DSO↑=收款恶化。
// 数据不足/基数≤0 → null(不臆造)。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export interface TurnoverInput {
  opening: number // 期初余额(存货/应收)
  closing: number // 期末余额
  base: number // 基数:存货用营业成本、应收用营业收入
  days?: number // 天数(年=365,季=90),默认 365
}

export interface TurnoverResult {
  avg_balance: number | null // 期初期末均值
  turnover_times: number | null // 周转次数 = 基数 ÷ 均值
  turnover_days: number | null // 周转天数 = 天数 ÷ 次数
}

const finite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x))

/** 周转天数 + 次数。基数≤0 或均值≤0 → null。 */
export function computeTurnover(input: TurnoverInput): TurnoverResult {
  const { opening, closing, base } = input
  const days = input.days ?? 365
  if (!finite(opening, closing, base, days)) {
    return { avg_balance: null, turnover_times: null, turnover_days: null }
  }
  const avg = (opening + closing) / 2
  if (avg <= 0 || base <= 0 || days <= 0) {
    return { avg_balance: avg > 0 ? avg : null, turnover_times: null, turnover_days: null }
  }
  const times = base / avg
  return { avg_balance: avg, turnover_times: times, turnover_days: days / times }
}
