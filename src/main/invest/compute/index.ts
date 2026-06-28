// src/main/invest/compute/index.ts —— 业务层: 计算层(invest_lib)公共入口
//
// 投资 agent 方法论 IP 的确定性计算。被 compute_* builtin 工具(薄包)消费。
// 允许依赖: ./types 及本目录各模块
// 禁止依赖: ipc/* / repos/* / mcp/*

export * from './types'
export { computeRedFlags, RED_FLAG_THRESHOLDS } from './red-flags'
export { computePercentile } from './percentile'
export { reverseDcf } from './reverse-dcf'
export type { ReverseDcfInput, ReverseDcfResult } from './reverse-dcf'
export { computeTrend } from './trend'
export { checkFalsification } from './falsification'
export type { FalsificationResult } from './falsification'
export { crossCheck } from './cross-check'
export type { CrossCheckResult } from './cross-check'
export { computeGate } from './gate'
export { computeValuation } from './valuation'
export type {
  ValuationMethod,
  ScenarioInput,
  ValuationInput,
  ScenarioValue,
  ValuationResult,
} from './valuation'
export { computeIndustryScore, INDUSTRY_THRESHOLDS } from './industry-score'
export type {
  IndustrySignal,
  IndustryScoreInput,
  IndustryDimResult,
  IndustryScoreResult,
} from './industry-score'
export { computeMacroClock, MACRO_THRESHOLDS } from './macro-clock'
export type { MacroQuadrant, EquityStance, MacroClockInput, MacroClockResult } from './macro-clock'
export { computeDupont } from './dupont'
export type { DupontInput, DupontResult } from './dupont'
export { computeProjection } from './projection'
export type { ProjectionInput, ProjectionYear, ProjectionResult } from './projection'
export { computeDecision } from './decision'
export type {
  Quality,
  ValuationState,
  MatrixCell,
  Action,
  DecisionInput,
  DecisionResult,
} from './decision'
export { computeTurnover } from './turnover'
export type { TurnoverInput, TurnoverResult } from './turnover'
export { buyTriggerPrice } from './buy-trigger'
export type { BuyTriggerInput, BuyTriggerResult } from './buy-trigger'
export { computeValuationTrace, METHOD_PARAMS } from '../../../shared/invest/valuation-trace'
export type {
  TraceAssumption,
  TraceStep,
  ValuationTrace,
} from '../../../shared/invest/valuation-trace'
export { computePosition } from './position'
export type { PositionInput, PositionResult } from './position'
