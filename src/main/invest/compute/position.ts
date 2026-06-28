// src/main/invest/compute/position.ts —— 业务层: 仓位的度(确定性)
//
// 散户生存第一律:不重仓单股;仓位随确信度 + 安全边际深度缩放、被风险预算封顶、随不确定性收缩。
// weight = 风险预算 × 确信度系数 × clamp(边际深度) × (1 − clamp(不确定性));封顶 = 风险预算。
// 非有限/越界 → 夹紧或 0(不臆造)。设计依据 value-chain-rigor.md §6。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

import type { Conviction } from '../../../shared/types/invest'

export interface PositionInput {
  margin_depth: number // 安全边际深度 0~1(现价低于价值越深越大)
  conviction: Conviction // 命门已验证程度(强化累积)
  risk_budget: number // 单股仓位上限(组合风险预算派生,如 0.10)
  uncertainty: number // 不确定性 0~1(V 区间宽/命门未验 → 越大越收)
}
export interface PositionResult {
  weight: number // 建议仓位(0 ~ risk_budget)
  capped: boolean // 是否被风险预算封顶
}

const CONV_FACTOR: Record<Conviction, number> = { high: 1, mid: 0.6, low: 0.3 }
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const finite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x))

/** 仓位 = 风险预算 × 确信度 × 边际深度 × (1−不确定性),封顶风险预算。非有限→0。 */
export function computePosition(input: PositionInput): PositionResult {
  const { margin_depth, conviction, risk_budget, uncertainty } = input
  if (!finite(margin_depth, risk_budget, uncertainty) || risk_budget <= 0) {
    return { weight: 0, capped: false }
  }
  const conv = CONV_FACTOR[conviction] ?? 0
  const raw = risk_budget * conv * clamp01(margin_depth) * (1 - clamp01(uncertainty))
  const weight = Math.max(0, Math.min(raw, risk_budget))
  return { weight, capped: weight > 0 && weight >= risk_budget } // 触顶风险预算
}
