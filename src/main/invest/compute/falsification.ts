// src/main/invest/compute/falsification.ts —— 业务层: 硬证伪比对(确定性)
//
// 标的卡支点 kind="hard" 的 trigger:连续 persistence 期满足 op/value 即触发(阈破信号)。
// series 为该 metric 的时间序列(新到旧)。软证伪由 agent 复读,不在本层。
// 注: 本函数只产"阈破没破"的确定性信号;支点 broken/holding 的裁定由 agent 做(mvp-design §4.2)。
//
// 允许依赖: ./types
// 禁止依赖: ipc/* / repos/* / mcp/*

import type { FalsificationRule } from './types'

function satisfies(op: FalsificationRule['op'], x: number, v: number): boolean {
  switch (op) {
    case '<':
      return x < v
    case '>':
      return x > v
    case '<=':
      return x <= v
    case '>=':
      return x >= v
    case '==':
      return x === v
  }
}

export interface FalsificationResult {
  triggered: boolean
  checkedPeriods: number
}

export function checkFalsification(
  rule: FalsificationRule,
  seriesNewToOld: number[],
): FalsificationResult {
  const recent = seriesNewToOld.slice(0, rule.persistence)
  const triggered =
    recent.length >= rule.persistence &&
    recent.every((x) => Number.isFinite(x) && satisfies(rule.op, x, rule.value))
  return { triggered, checkedPeriods: recent.length }
}
