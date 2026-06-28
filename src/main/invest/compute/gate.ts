// src/main/invest/compute/gate.ts —— 业务层: 决策闸(管控区,确定性)
//
// 四层卡"管控区"的输出:风向(regime,自上而下)+ 下行约束(riskBounds,自下而上)
// → 确定性算出 gate.state,凌驾单卡判断闸住决策。LLM 不自填 state(本层是唯一裁定)。
// 优先级穷举(高→低):否决 > 节流 > 警告 > 通行。设计依据 implementation-plan §1.1/§2/AC-007。
//
// 允许依赖: ./types
// 禁止依赖: ipc/* / repos/* / mcp/*

import type { GateInput, Gate } from './types'

export function computeGate({ regime, riskBounds }: GateInput): Gate {
  const vetoHits = riskBounds.veto.filter((v) => v.status === 'triggered').map((v) => v.rule)
  const mos = riskBounds.marginOfSafety
  // 安全边际两端均有限才比较;含 NaN → 不误触发节流(缺数据不臆造)
  const mosBreached =
    Number.isFinite(mos.required) && Number.isFinite(mos.current) && mos.current < mos.required

  // 1. 否决:一票否决命中 或 系统性风险极端
  if (vetoHits.length > 0 || regime.systemic === 'extreme') {
    return {
      state: '否决',
      reason: [...vetoHits, ...(regime.systemic === 'extreme' ? ['系统性风险极端'] : [])],
    }
  }
  // 2. 节流:安全边际不足 或 风向恶化
  if (mosBreached || regime.direction === '恶化') {
    return {
      state: '节流',
      reason: [
        ...(mosBreached ? ['安全边际不足'] : []),
        ...(regime.direction === '恶化' ? ['风向恶化'] : []),
      ],
    }
  }
  // 3. 警告:系统性风险预警
  if (regime.systemic === 'warning') return { state: '警告', reason: ['系统性风险预警'] }
  // 4. 通行
  return { state: '通行', reason: [] }
}
