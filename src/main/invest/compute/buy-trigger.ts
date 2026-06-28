// src/main/invest/compute/buy-trigger.ts —— 业务层: 安全边际买点价(确定性)
//
// 「等回调 ¥X 以下」的 X:逻辑成立 ≠ 该买,还得价格进安全边际(README §7、不变量⑥)。
// 安全边际 vs 锚保守端 V(默认 V_bear)≥ 门槛 ⟺ 价格 ≤ 锚价 × (1 − 门槛)。
// 该价 = 可建/加仓的价格上限(P ≤ trigger ⟺ at_buy_point)。价值由 compute 算,不在前端硬算。
// 门槛非法 / 锚价≤0 / 非有限 → null(不臆造)。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export interface BuyTriggerInput {
  bear: number // V_bear(熊市价值)
  base: number // V_base(中性价值)
  required: number // 安全边际门槛 0~1(<1)
  anchor?: 'bear' | 'base' // 锚哪端,默认 bear(锚保守端)
}

export interface BuyTriggerResult {
  trigger: number | null // 买点价上限:P ≤ trigger ⟺ 安全边际达标
  anchor_value: number | null // 所锚的 V(bear / base)
  anchor: 'bear' | 'base'
}

const finite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x))

/** 买点价 = 锚价 × (1 − 门槛)。门槛∉[0,1) 或锚价≤0/非有限 → trigger=null。 */
export function buyTriggerPrice(input: BuyTriggerInput): BuyTriggerResult {
  const anchor = input.anchor ?? 'bear'
  const anchorValue = anchor === 'base' ? input.base : input.bear
  const { required } = input
  if (!finite(anchorValue, required) || anchorValue <= 0 || required < 0 || required >= 1) {
    return {
      trigger: null,
      anchor_value: Number.isFinite(anchorValue) ? anchorValue : null,
      anchor,
    }
  }
  return { trigger: anchorValue * (1 - required), anchor_value: anchorValue, anchor }
}
