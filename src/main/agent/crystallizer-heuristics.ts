// src/main/agent/crystallizer-heuristics.ts — 业务层：Crystallizer 模式自动推荐
//
// 启发式给"快速 (express) / 分步 (guided)"一个建议默认值。最终决定权在用户：
//   1. 用户在对话中显式说 "express" / "guided" / "分步" / "快一点" → 立即切换
//   2. UI 启动对话框里的 toggle → 覆盖启发式
//   3. 启发式默认值 → 仅作为初始建议
//
// 触发 guided 模式的信号:
//   - 长对话 (turns > 30) → 信息密度高,分段确认更稳
//   - 多次失败 (failures > 5) → 噪声多,需要一段段确认避免漂移
//   - 多 workflow 候选 (≥2 个不同主题) → 必须先 disambiguate
//   - 用户首次导出 → 不熟悉 schema,分步引导更友好
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*、repos/*

export type CrystallizerMode = 'express' | 'guided'

/** 输入信号：调用方按需求填充。任意字段 undefined 时该信号不参与判定。 */
export interface CrystallizerHeuristicInput {
  /** session 消息总数（user + assistant，含 tool 消息） */
  turnCount?: number
  /** 已观察到的失败 / 错误结果数量 (tool-result 含错误信封 / errored=true 等) */
  failureCount?: number
  /** chat 中识别到的不同主题/工作流候选数（粗略） */
  workflowCandidateCount?: number
  /** 用户此前是否成功导出过 agent (false → 首次,推荐 guided) */
  hasPriorExports?: boolean
}

/** 启发式推荐结果：mode + 触发原因（供 UI 展示给用户解释为什么默认 guided） */
export interface CrystallizerRecommendation {
  mode: CrystallizerMode
  /** 触发的信号简述 (用于 UI 提示, e.g., "对话较长 / 多次失败") */
  reasons: string[]
}

const TURN_THRESHOLD = 30
const FAILURE_THRESHOLD = 5
const WORKFLOW_THRESHOLD = 2

export function recommendMode(input: CrystallizerHeuristicInput): CrystallizerRecommendation {
  const reasons: string[] = []

  if (typeof input.turnCount === 'number' && input.turnCount > TURN_THRESHOLD) {
    reasons.push(`对话较长 (${input.turnCount} 轮)`)
  }
  if (typeof input.failureCount === 'number' && input.failureCount > FAILURE_THRESHOLD) {
    reasons.push(`失败次数较多 (${input.failureCount} 次)`)
  }
  if (
    typeof input.workflowCandidateCount === 'number' &&
    input.workflowCandidateCount >= WORKFLOW_THRESHOLD
  ) {
    reasons.push(`包含 ${input.workflowCandidateCount} 个候选工作流`)
  }
  if (input.hasPriorExports === false) {
    reasons.push('首次导出 agent')
  }

  return reasons.length > 0
    ? { mode: 'guided', reasons }
    : { mode: 'express', reasons: ['对话紧凑,可一次性导出'] }
}

/**
 * 解析用户在对话中的显式模式切换意图。空字符串 / 不匹配 → null。
 *
 * 例:
 *   "直接给完整草稿"      → 'express'
 *   "express"             → 'express'
 *   "快一点"              → 'express'
 *   "guided"              → 'guided'
 *   "分步走"              → 'guided'
 *   "走一步看一步"        → 'guided'
 */
const EXPRESS_PATTERNS = [
  /\bexpress\b/i,
  /直接给(完整)?(草稿|JSON)/,
  /快一点/,
  /一次性(给|输出)/,
  /别(分步|guided)/,
]
const GUIDED_PATTERNS = [/\bguided\b/i, /分步/, /走一步看一步/, /一段一段/, /逐段(确认|讨论)/]

export function detectModeSwitch(text: string): CrystallizerMode | null {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  if (t === '') return null
  if (EXPRESS_PATTERNS.some((re) => re.test(t))) return 'express'
  if (GUIDED_PATTERNS.some((re) => re.test(t))) return 'guided'
  return null
}
