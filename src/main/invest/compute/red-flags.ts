// src/main/invest/compute/red-flags.ts —— 业务层: 财务排雷(8 红灯, 确定性)
//
// mvp-design §3 财务事实 / red_flags。每条返回 {flag,hit,value,note};
// hit=null 表示数据缺失(NaN)不可判。
//
// 允许依赖: ./types
// 禁止依赖: ipc/* / repos/* / mcp/*

import type { NormalizedFinancials, RedFlag } from './types'

export const RED_FLAG_THRESHOLDS = {
  ocfToNi: 1, // 经营现金流/净利润 < 此值 触发(仅净利>0 时比值才有意义)
  growthGapPp: 15, // 应收/存货增速 − 营收增速 > 此(百分点)触发
  goodwillToEquity: 0.3, // 商誉/净资产 > 此 触发
  debtToAssets: 0.6, // 有息负债/总资产 > 此 触发
  doubleHigh: 0.5, // 货币资金/总资产 与 有息负债/总资产 同时 > 此 = 存贷双高
} as const

function finite(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x))
}

export function computeRedFlags(f: NormalizedFinancials): RedFlag[] {
  const flags: RedFlag[] = []
  const T = RED_FLAG_THRESHOLDS

  // 1. 经营现金流/净利润 < 1(白条);仅净利 > 0 时比值有意义(亏损含金量交由 deducted_neg)
  flags.push(
    finite(f.ocf, f.net_income) && f.net_income > 0
      ? {
          flag: 'ocf_ni_lt_1',
          hit: f.ocf / f.net_income < T.ocfToNi,
          value: f.ocf / f.net_income,
          note: '经营现金流/净利润',
        }
      : { flag: 'ocf_ni_lt_1', hit: null, value: null, note: '数据缺失或净利非正,不适用' },
  )

  // 2. 应收增速 >> 营收增速
  flags.push(
    finite(f.ar_yoy, f.rev_yoy)
      ? {
          flag: 'ar_growth_gt_rev',
          hit: f.ar_yoy - f.rev_yoy > T.growthGapPp,
          value: f.ar_yoy - f.rev_yoy,
          note: '应收增速−营收增速(pp)',
        }
      : { flag: 'ar_growth_gt_rev', hit: null, value: null, note: '数据缺失' },
  )

  // 3. 存货增速 >> 营收增速
  flags.push(
    finite(f.inv_yoy, f.rev_yoy)
      ? {
          flag: 'inv_growth_gt_rev',
          hit: f.inv_yoy - f.rev_yoy > T.growthGapPp,
          value: f.inv_yoy - f.rev_yoy,
          note: '存货增速−营收增速(pp)',
        }
      : { flag: 'inv_growth_gt_rev', hit: null, value: null, note: '数据缺失' },
  )

  // 4. 商誉/净资产过高
  flags.push(
    finite(f.goodwill, f.equity) && f.equity !== 0
      ? {
          flag: 'goodwill_high',
          hit: f.goodwill / f.equity > T.goodwillToEquity,
          value: f.goodwill / f.equity,
          note: '商誉/净资产',
        }
      : { flag: 'goodwill_high', hit: null, value: null, note: '数据缺失' },
  )

  // 5. 有息负债/总资产过高
  flags.push(
    finite(f.interest_debt, f.total_assets) && f.total_assets !== 0
      ? {
          flag: 'debt_high',
          hit: f.interest_debt / f.total_assets > T.debtToAssets,
          value: f.interest_debt / f.total_assets,
          note: '有息负债/总资产',
        }
      : { flag: 'debt_high', hit: null, value: null, note: '数据缺失' },
  )

  // 6. 扣非持续为负(全部期数均 < 0)
  flags.push(
    f.deducted_ni_history.length > 0 && f.deducted_ni_history.every((x) => Number.isFinite(x))
      ? {
          flag: 'deducted_neg',
          hit: f.deducted_ni_history.every((x) => x < 0),
          value: Math.max(...f.deducted_ni_history),
          note: '扣非净利近 N 期',
        }
      : { flag: 'deducted_neg', hit: null, value: null, note: '数据缺失' },
  )

  // 7. 存贷双高
  flags.push(
    finite(f.cash, f.interest_debt, f.total_assets) && f.total_assets !== 0
      ? {
          flag: 'cash_debt_double_high',
          hit:
            f.cash / f.total_assets > T.doubleHigh &&
            f.interest_debt / f.total_assets > T.doubleHigh,
          value: null,
          note: '货币资金与有息负债占比双高',
        }
      : { flag: 'cash_debt_double_high', hit: null, value: null, note: '数据缺失' },
  )

  // 8. 审计意见非标(一票否决)
  flags.push({
    flag: 'audit_nonstandard',
    hit: f.audit_nonstandard,
    value: null,
    note: '审计意见非标 = 一票否决',
  })

  return flags
}
