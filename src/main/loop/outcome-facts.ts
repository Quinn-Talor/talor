// src/main/loop/outcome-facts.ts —— 业务层: 派生 outcome 的事实信号
//
// 一次性把 StepOutcome 派生为各 detector 共用的信号集 (OutcomeFacts),
// 避免主循环 / detector 各自重新从 outcome 字段判断同一信号 (4 处重复 → 1 处)。
//
// v3.6 扩展: 在 classify 时一次性解析 stepText 的 talor blocks, 派生 hasDone /
// hasNeedInput / hasBlocked / hasPendingConfirm / hasWarning + 旧 legacy marker
// 信号。Detector 通过 facts.hasTermination 判定收尾 (合并 talor block + legacy
// marker), 不再各自调用 parseTalorBlocks (避免重复解析 + 信号漂移)。
//
// 允许依赖: ./types, @shared/talor-blocks/*
// 禁止依赖: ipc/*

import type { StepOutcome } from './types'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'
import { parseTalorBlocks } from '@shared/talor-blocks/talor-block-parser'

/**
 * BEHAVIORAL_CHARTER Rule 13 旧版的三种 legacy 终止 marker。
 *
 * v3.6 主路径是 talor block (done / need_input / blocked), 这里保留 legacy
 * marker 作向后兼容兜底 (弱模型 / 旧 conversation 历史可能仍输出文字 marker)。
 *
 * 与 SystemPlugin.BEHAVIORAL_CHARTER Rule 13 "Legacy text markers" 段同步;
 * 若那里调整 marker 文本,本处必须同步。
 * 设计上严格 includes (非 fuzzy match) — 接受少量假阴, 防止"已完成"被误判为有 marker。
 */
export const TERMINATION_MARKERS = ['✓ Done', '❓ Need input', '⏸ Blocked'] as const

/** 检测 text 是否含 Rule 13 三种 legacy marker 之一。 */
export function hasTerminationMarker(text: string): boolean {
  if (!text) return false
  for (const marker of TERMINATION_MARKERS) {
    if (text.includes(marker)) return true
  }
  return false
}

/**
 * v3.6: 合并的"显式收尾"信号 — talor block(done/need_input/blocked) OR
 * legacy 文字 marker(✓/❓/⏸)。
 *
 * runReactStep 用此函数判定"是否落 final, 是否结束 loop"。
 *
 * 为什么不用 hasTerminationMarker 单独判定: Rule 13 重写后 talor block 是主路径,
 * legacy marker 只是弱模型兼容。如果只看 legacy,模型 emit talor need_input 后
 * react-loop 会误判为"想停但没收尾",继续跑 + 注入 PENDING_MARKER_HINT,直到
 * forced-closure 兜底 — 即"等不到用户输入反而又跑了几步"的 bug。
 *
 * 内部用 parseTalorBlocks 做结构化判定; mid-turn 的 pending_confirm / warning
 * 块不算收尾(它们要配合 tool call 一起走)。
 */
export function hasTerminationInText(text: string): boolean {
  if (!text) return false
  if (hasTerminationMarker(text)) return true
  const { blocks } = parseTalorBlocks(text)
  return blocks.some((b) => b.type === 'done' || b.type === 'need_input' || b.type === 'blocked')
}

/**
 * v3.6: 隐式 "我在问用户" 启发式 — 弱模型经常忘了 emit need_input block 也忘了
 * 写 legacy `❓` marker,只是直接抛问题。如果不识别,react-loop 会把这种 step
 * 当成"想停但没收尾",进 no-marker streak,3 次后 forced-closure 兜底,
 * 模型可能在 forced-closure 模式下凭空自答(灾难性,绕过用户授权)。
 *
 * 触发任一条即视为隐式问句 (高召回, 容忍少量假阳性):
 *   - 文本含 `?` 或 `?` (中英文问号 — 任一即可)
 *   - 列举选项模式: "X / Y / Z" 三项以上斜杠分隔 (即"请选一个"语义)
 *
 * 故意不命中:
 *   - "select id from x" 这种叙述 (无问号 + 无连续斜杠列举)
 *   - 单个 "?" 在 URL/路径中 (太罕见,实际场景命中即真问句)
 *
 * 假阳性代价: 模型在中段叙述问号(rare) → step 提前判定为 final, 但下一轮
 *   用户可以补完。比"误进 forced-closure 强制兜底"代价小得多。
 *
 * 调用方约定: 仅在 (no tool calls && no termination marker/block) 的兜底分支
 *   使用 — 已经有显式收尾就走 hasTerminationInText 主路径。
 */
export function looksLikeOpenQuestion(text: string): boolean {
  if (!text) return false
  // 中英文问号任一即视为问句信号
  if (/[?？]/.test(text)) return true
  // 列举选项 "X / Y / Z [/ ...]" — 至少 3 项, 斜杠两侧"必须"有空白。
  // 必须有空白才能与代码路径区分开 (`/etc/foo/bar.conf` 没有空白, 不命中;
  // "内地 / 香港 / 日本" 有空白, 命中)。漏掉无空格的中文 "X/Y/Z" 是可接受
  // 的假阴 — 比误命中代码路径强。
  if (/\S+\s+\/\s+\S+\s+\/\s+\S+/.test(text)) return true
  return false
}

/**
 * 派生自 StepOutcome 的事实信号, 给各 detector 消费。
 *
 * 设计原则:
 *   - 字段全为纯派生 (无副作用)
 *   - 命名以 "has*" / "is*" / 信号名为主, 易读
 *   - allToolsFailed 保留三态语义 (null / true / false)
 *
 * v3.6 talor block 字段:
 *   - blocks: 当步解析成功的 TalorBlock[] (供 SemanticDetector + RiskGate 消费)
 *   - invalidBlocks: 解析失败的原始片段 (UI 兜底渲染 / 日志)
 *   - hasDone / hasNeedInput / ...: 各类 block 是否存在的快速布尔
 *   - hasLegacyMarker: 仅 legacy 文字 marker (无 talor block)
 *   - hasTermination: 合并信号 = hasDone || hasNeedInput || hasBlocked || hasLegacyMarker
 *     主循环 / no-marker detector 用此字段判定"已显式收尾"
 */
export interface OutcomeFacts {
  /** outcome.toolNames.length > 0 */
  hasToolCall: boolean
  /** outcome.stepText.trim() !== '' */
  hasText: boolean
  /** hasTermination 的别名 — 保留供旧 detector 不改动 */
  hasMarker: boolean
  /** outcome.allToolsFailed: null=无工具调用, true=全失败, false=至少一成功 */
  allToolsFailed: boolean | null
  /** outcome.containsSubagentFailure — SUBAGENT_* / DELEGATION_* envelope */
  isSubagentFailure: boolean
  /** outcome.signature — 复合签名 (含工具时非空) */
  signature: string
  // v3.7: noMarkerExit 字段已删除 —— no_tool_calls_no_marker exit reason 不再存在,
  // "无 marker" 不再是 bug 信号 (无 tool = 自然 final)。
  /** outcome.toolNames 透传 — SemanticDetector 判定 side-effect 工具时需要 */
  toolNames: readonly string[]

  // ── v3.6 talor block 字段 ─────────────────────────────────────────
  /** 当步解析成功的 talor blocks */
  blocks: TalorBlock[]
  /** 解析失败的 talor block 片段 + 原因 */
  invalidBlocks: Array<{ raw: string; reason: string }>
  /** 是否有 done block */
  hasDone: boolean
  /** 是否有 need_input block */
  hasNeedInput: boolean
  /** 是否有 blocked block */
  hasBlocked: boolean
  /** 是否有 pending_confirm block */
  hasPendingConfirm: boolean
  /** 是否有 warning block */
  hasWarning: boolean
  /** 仅 legacy 文字 marker (✓/❓/⏸) — 弱模型兼容 */
  hasLegacyMarker: boolean
  /**
   * 合并的"已显式收尾"信号 = hasDone || hasNeedInput || hasBlocked || hasLegacyMarker。
   * 主循环 / no-marker detector 用此字段判定 — 不再单独看 hasMarker。
   */
  hasTermination: boolean
}

/** 一次性把 StepOutcome 派生为 OutcomeFacts。 */
export function classify(outcome: StepOutcome): OutcomeFacts {
  const { blocks, invalid } = parseTalorBlocks(outcome.stepText)
  const hasDone = blocks.some((b) => b.type === 'done')
  const hasNeedInput = blocks.some((b) => b.type === 'need_input')
  const hasBlocked = blocks.some((b) => b.type === 'blocked')
  const hasPendingConfirm = blocks.some((b) => b.type === 'pending_confirm')
  const hasWarning = blocks.some((b) => b.type === 'warning')
  const hasLegacyMarker = hasTerminationMarker(outcome.stepText)
  const hasTermination = hasDone || hasNeedInput || hasBlocked || hasLegacyMarker

  return {
    hasToolCall: outcome.toolNames.length > 0,
    hasText: outcome.stepText.trim() !== '',
    hasMarker: hasTermination,
    allToolsFailed: outcome.allToolsFailed,
    isSubagentFailure: outcome.containsSubagentFailure,
    signature: outcome.signature,
    toolNames: outcome.toolNames,
    blocks,
    invalidBlocks: invalid,
    hasDone,
    hasNeedInput,
    hasBlocked,
    hasPendingConfirm,
    hasWarning,
    hasLegacyMarker,
    hasTermination,
  }
}
