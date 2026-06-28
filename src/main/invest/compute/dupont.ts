// src/main/invest/compute/dupont.ts —— 业务层: 杜邦 ROE 拆解(确定性)
//
// ROE = 净利率 × 总资产周转率 × 权益乘数。拆开看赚钱质量(高利率/高周转/高杠杆三条路),
// 并标出主要驱动项(最大边际贡献)。任何分母缺失/≤0 → 对应比率 null,不臆造。
// 用于"公司质地"维:支撑命门 quant 的 ROE 立足点(净利率 ref→利润表,周转 ref→资产负债表)。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export interface DupontInput {
  net_income: number // 净利润
  revenue: number // 营业收入
  total_assets: number // 总资产(可用期初期末均值)
  equity: number // 净资产(归母权益)
}

export interface DupontResult {
  net_margin: number | null // 净利率 = 净利润/营收
  asset_turnover: number | null // 总资产周转率 = 营收/总资产
  equity_multiplier: number | null // 权益乘数 = 总资产/净资产
  roe: number | null // 三项乘积(= 净利润/净资产)
  driver: 'margin' | 'turnover' | 'leverage' | null // 偏离 1 最大的主驱动(谁把 ROE 撑起来)
}

const ok = (x: number, allowZero = false): boolean =>
  Number.isFinite(x) && (allowZero ? true : x !== 0)

/**
 * 杜邦三因子拆解 + 主驱动识别。
 * driver = 三因子中"相对 1 的偏离度"最大者:净利率/周转率/(权益乘数−1),量纲归一后比大小。
 * 任一因子不可算 → driver=null(残缺不判主驱动)。
 */
export function computeDupont(f: DupontInput): DupontResult {
  const net_margin =
    ok(f.revenue) && Number.isFinite(f.net_income) ? f.net_income / f.revenue : null
  const asset_turnover =
    ok(f.total_assets) && Number.isFinite(f.revenue) ? f.revenue / f.total_assets : null
  const equity_multiplier =
    ok(f.equity) && Number.isFinite(f.total_assets) ? f.total_assets / f.equity : null

  const roe =
    net_margin !== null && asset_turnover !== null && equity_multiplier !== null
      ? net_margin * asset_turnover * equity_multiplier
      : null

  let driver: DupontResult['driver'] = null
  if (net_margin !== null && asset_turnover !== null && equity_multiplier !== null) {
    // 杠杆贡献以"超出自有资金的倍数"(乘数−1)衡量,与利率/周转同向比较
    const contrib: Array<[DupontResult['driver'], number]> = [
      ['margin', Math.abs(net_margin)],
      ['turnover', Math.abs(asset_turnover)],
      ['leverage', Math.abs(equity_multiplier - 1)],
    ]
    driver = contrib.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
  }

  return { net_margin, asset_turnover, equity_multiplier, roe, driver }
}
