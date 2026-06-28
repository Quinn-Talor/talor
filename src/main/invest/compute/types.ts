// src/main/invest/compute/types.ts —— 业务层: 计算层(invest_lib)数据契约与信号类型
//
// invest_lib = 方法论 IP 的确定性计算(排雷/分位/逆向DCF/趋势/硬证伪/可靠性)。
// 输入 = 归一化数据契约(由 MCP 适配/LLM 喂入);输出 = 结构化信号。LLM 永不算这些。
// 设计依据: docs/investment-agent/mvp-design.md §8.2 / §3。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

/** 归一化的标的财务输入(排雷所需)。 */
export interface NormalizedFinancials {
  ocf: number // 经营现金流
  net_income: number // 归母净利润
  deducted_ni_history: number[] // 近 N 期扣非净利(新到旧),用于"持续为负"判定
  rev_yoy: number // 营收同比 %
  ar_yoy: number // 应收账款同比 %
  inv_yoy: number // 存货同比 %
  goodwill: number // 商誉
  equity: number // 净资产
  interest_debt: number // 有息负债
  total_assets: number
  cash: number // 货币资金
  audit_nonstandard: boolean // 审计意见是否非标
}

/** 单条排雷红灯结果。hit=null 表示数据缺失不可判(绝不在缺数据时误判"安全")。 */
export interface RedFlag {
  flag: string // 与标的卡 red_flags 对齐的标识
  hit: boolean | null
  value: number | null
  note: string
}

/** 硬证伪规则(标的卡支点 kind="hard" 的 trigger)。 */
export interface FalsificationRule {
  metric: string
  op: '<' | '>' | '<=' | '>=' | '=='
  value: number
  persistence: number // 需连续满足的期数(1=单期即触发)
}

/** 多源取值(同一字段、不同来源),用于交叉校验。 */
export interface SourcedValue {
  value: number
  source: string
}

/** 单窗口趋势。 */
export interface TrendWindow {
  window: number // 回溯步数(交易日数 或 报告期数)
  change: number | null
  change_pct: number | null
  direction: 'up' | 'down' | 'flat' | null
}

/** 多窗口趋势 + 动能形态。 */
export interface TrendResult {
  windows: TrendWindow[]
  momentum: 'accelerating' | 'decelerating' | 'reversing' | 'flat' | null
}

// —— 决策闸(系统风险)类型 —— compute 层自有。computeGate 产出 {state,reason},
// 由 agent 经 compute_macro_clock 判断后填入 checkpoint.gate(store 不再代算)。
export type GateState = '通行' | '警告' | '节流' | '否决'
export interface GateRegime {
  systemic: 'normal' | 'warning' | 'extreme'
  direction: '改善' | '持平' | '恶化'
}
export interface GateRiskBounds {
  marginOfSafety: { required: number; current: number }
  veto: { rule: string; status: 'clear' | 'triggered' }[]
}
export interface GateInput {
  regime: GateRegime
  riskBounds: GateRiskBounds
}
export interface Gate {
  state: GateState
  reason: string[]
}
