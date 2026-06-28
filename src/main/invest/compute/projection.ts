// src/main/invest/compute/projection.ts —— 业务层: EPS 自下而上测算(确定性)
//
// 把"行业增速 × 公司份额变化 → 营收;营收 × 净利率 → 净利;÷ 股本 → EPS"这条链确定性算出。
// 立足点(行业增速 ref→行业事实、份额/净利率 ref→公司事实)由 agent 溯源,本函数只做数值组合。
// 支撑 valuation(pe/dcf)的 EPS 参数,让估值闭环到可验证的驱动假设,而非拍一个 EPS。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export interface ProjectionInput {
  base_revenue: number // 基期营收(元/亿,单位自洽)
  industry_growth_pct: number // 行业年增速(%,如 15 表示 +15%)
  share_delta_pct: number // 公司份额年变化(%,正=抢份额,负=丢份额)
  net_margin_pct: number // 净利率(%,如 12 表示 12%)
  shares: number // 总股本(与 base_revenue 同单位口径)
  horizon_years?: number // 预测年数(默认 1)
}

export interface ProjectionYear {
  year: number // 第 n 年(1-based)
  revenue: number
  net_income: number
  eps: number
}

export interface ProjectionResult {
  years: ProjectionYear[] | null // 任一关键输入缺失 → null(不在残缺上外推)
  end_eps: number | null // 末年 EPS
  eps_cagr: number | null // 起点(基期 EPS)→末年 EPS 的年复合(horizon≥1 且基期 EPS>0)
}

const finite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x))

/**
 * 自下而上多年 EPS 测算。
 * 每年:营收 ×= (1+行业增速)×(1+份额变化);净利 = 营收×净利率;EPS = 净利/股本。
 * eps_cagr 以基期 EPS(base_revenue×净利率/股本)为起点;基期 EPS≤0 或 horizon<1 → null。
 */
export function computeProjection(input: ProjectionInput): ProjectionResult {
  const { base_revenue, industry_growth_pct, share_delta_pct, net_margin_pct, shares } = input
  const horizon = input.horizon_years ?? 1
  if (
    !finite(base_revenue, industry_growth_pct, share_delta_pct, net_margin_pct, shares) ||
    shares <= 0 ||
    horizon < 1
  ) {
    return { years: null, end_eps: null, eps_cagr: null }
  }

  const margin = net_margin_pct / 100
  const growthFactor = (1 + industry_growth_pct / 100) * (1 + share_delta_pct / 100)
  const years: ProjectionYear[] = []
  let revenue = base_revenue
  for (let y = 1; y <= horizon; y++) {
    revenue = revenue * growthFactor
    const net_income = revenue * margin
    years.push({ year: y, revenue, net_income, eps: net_income / shares })
  }

  const end_eps = years[years.length - 1].eps
  const base_eps = (base_revenue * margin) / shares
  const eps_cagr =
    base_eps > 0 && end_eps > 0 ? Math.pow(end_eps / base_eps, 1 / horizon) - 1 : null

  return { years, end_eps, eps_cagr }
}
