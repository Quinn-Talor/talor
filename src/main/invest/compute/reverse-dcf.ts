// src/main/invest/compute/reverse-dcf.ts —— 业务层: 逆向 DCF 现实性检验(确定性)
//
// 反推当前价隐含的 N 年 EPS 年复合增速,判断是否离谱(估值现实性)。
// 简化闭式(终值法, 忽略期间分红):
//   price = eps·(1+g)^N · exitPe / (1+discount)^N
//   ⇒ g = ((price·(1+discount)^N) / (eps·exitPe))^(1/N) − 1
// 忽略期间分红 → 偏保守(略高估所需增速,方向安全)。mvp-design §8.2。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export interface ReverseDcfInput {
  price: number
  eps: number
  exitPe: number
  horizonYears: number
  discount: number
  reasonableMaxGrowth?: number // 默认 0.30
}

export interface ReverseDcfResult {
  impliedGrowth: number | null
  reasonable: boolean | null
}

export function reverseDcf(input: ReverseDcfInput): ReverseDcfResult {
  const { price, eps, exitPe, horizonYears: n, discount } = input
  const cap = input.reasonableMaxGrowth ?? 0.3
  if (
    ![price, eps, exitPe, n, discount].every(Number.isFinite) ||
    eps <= 0 ||
    exitPe <= 0 ||
    n <= 0
  ) {
    return { impliedGrowth: null, reasonable: null }
  }
  const ratio = (price * Math.pow(1 + discount, n)) / (eps * exitPe)
  if (ratio <= 0) return { impliedGrowth: null, reasonable: null }
  const g = Math.pow(ratio, 1 / n) - 1
  return { impliedGrowth: g, reasonable: g <= cap }
}
