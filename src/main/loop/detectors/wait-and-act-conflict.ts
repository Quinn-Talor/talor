// src/main/loop/detectors/wait-and-act-conflict.ts —— 业务层: 语义一致性 Detector
//
// v3.6 L2 SemanticDetector — 捕捉"等待对偶面"反模式:
//   模型文本声明在等用户/外部条件,同步却调了工具做实际操作 → 意图冲突。
//
// 触发条件 (全部满足):
//   1. 本步有工具调用 (facts.hasToolCall)
//   2. stepText 含"等待"信号 (中英双语 regex)
//   3. 没有 need_input / pending_confirm block 把"等"的语义结构化掉
//   4. 工具调用是 side-effecting (非 read/glob/grep/ls/skill 等只读工具)
//
// 触发动作: 非破坏性 — 只注入 hint 提醒模型,不 break 主循环。
// 设计依据: detector 拿不到工具白名单/黑名单,因此用"通用副作用工具名"
// 排除只读;具体业务由 LLM 通过 pending_confirm block 自判 (设计原则 #6)。
//
// 允许依赖: ./types, ../outcome-facts
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict, DetectorRawContext } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'

/**
 * 等待/暂停意图的通用 regex (中英双语)。
 *
 * 不命中: "wait for response" (合理调用 streaming 的 description) — 用否定预查会过严,
 *         保持简单 regex + 后续白名单工具集组合判定。
 */
const WAIT_INTENT_PATTERNS: RegExp[] = [
  /\b(?:wait(?:ing)?\s+for|pause\s+(?:until|for)|hold\s+off|let'?s\s+wait|before\s+proceeding)\b/i,
  /\b(?:waiting\s+on\s+your|need\s+your\s+(?:input|approval|decision|confirmation))\b/i,
  /等(?:待|你|您|用户|回复|输入|确认|批准|授权|反馈|指示|许可)/,
  /先(?:不|暂|等)/,
  /(?:暂停|稍等|稍候|等等)/,
  /(?:在|等)你(?:回复|输入|确认|批准|授权|许可|决定|反馈)(?:后|之后)/,
]

/**
 * 只读工具白名单 — 这些工具被调用时不算"和等待意图冲突"。
 *
 * 设计上不绑死具体业务工具名,只覆盖 talor 内置的明确只读 builtin;
 * MCP / skill / 自定义工具一律视为 side-effecting (保守判定)。
 */
const READ_ONLY_TOOL_NAMES = new Set(['read', 'glob', 'grep', 'ls', 'search_tool'])

/** 检查 stepText 是否含"等待"意图。 */
export function hasWaitIntent(text: string): boolean {
  if (!text) return false
  for (const re of WAIT_INTENT_PATTERNS) {
    if (re.test(text)) return true
  }
  return false
}

/** 至少一个工具调用是 side-effecting (不在只读白名单里)。 */
function someToolIsSideEffecting(
  toolNames: readonly string[],
  readOnly: ReadonlySet<string>,
): boolean {
  return toolNames.some((n) => !readOnly.has(n))
}

const WAIT_AND_ACT_HINT =
  '[Wait/Act conflict] Your reply expressed an intent to WAIT for the user or an external ' +
  'signal, but in the same step you invoked one or more side-effecting tools. These two are ' +
  'mutually exclusive — pick one:\n' +
  '  (a) Truly wait → do NOT call any tool this step; close the turn with a `need_input` ' +
  'talor block:\n' +
  '      ```talor\n' +
  '      {"type":"need_input","question":"<what you need from the user>"}\n' +
  '      ```\n' +
  '  (b) Proceed → drop the "waiting" wording and continue executing.\n' +
  '\nIf the action is risky / has side effects, emit a `pending_confirm` talor block in the ' +
  'SAME step as the tool call (see Rule 14) to ask the user for explicit approval before running.'

export interface WaitAndActConflictOpts {
  /**
   * Side-effecting 工具的额外白名单 (扩展只读集)。
   * 例: 测试或 host 想把某 MCP tool 标记为只读, 通过这里传入。
   */
  extraReadOnlyTools?: ReadonlySet<string>
}

/**
 * Wait/Act 冲突 detector。
 *
 * 命中后只发 hint, 不 break — 是"软纠偏",让模型在下一步自行修正。下一步若仍冲突,
 * Phase 1B 的 signature-dead-loop / no-marker-streak 会接管硬阻断。
 *
 * v3.6 接口约定: observe(facts, stepIndex?, raw?) — raw 必传,这里 toolNames 需要从
 * raw 取(为避免改 OutcomeFacts 接口添加 toolNames 字段,raw 携带"原文"语义信号)。
 */
export class WaitAndActConflictDetector implements LoopDetector {
  readonly name = 'wait-and-act-conflict'

  private triggered = false
  private readonly readOnly: ReadonlySet<string>

  constructor(opts: WaitAndActConflictOpts = {}) {
    if (opts.extraReadOnlyTools) {
      this.readOnly = new Set([...READ_ONLY_TOOL_NAMES, ...opts.extraReadOnlyTools])
    } else {
      this.readOnly = READ_ONLY_TOOL_NAMES
    }
  }

  observe(facts: OutcomeFacts, _stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict {
    // reset prev-step hint state (hint 只生效一次)
    this.triggered = false

    if (!facts.hasToolCall) return NO_TRIGGER
    if (!raw) return NO_TRIGGER

    // 已有结构化等待表达 (need_input / pending_confirm) → 模型已正确表达,不再冲突
    if (facts.hasNeedInput || facts.hasPendingConfirm) return NO_TRIGGER

    if (!hasWaitIntent(raw.stepText)) return NO_TRIGGER

    // 至少一个 side-effecting 工具 — 只读工具被调用不算冲突
    if (!someToolIsSideEffecting(facts.toolNames, this.readOnly)) return NO_TRIGGER

    log.warn(
      '[WaitAndActConflict] detected — stepText expresses wait intent + side-effect tool call',
    )
    this.triggered = true
    // 非 fatal — 只发 hint, 不 break / 不 forced summary
    return NO_TRIGGER
  }

  nextHint(): string | null {
    return this.triggered ? WAIT_AND_ACT_HINT : null
  }
}

/** 测试用 export (内部 helper) */
export const __TEST__ = { hasWaitIntent, READ_ONLY_TOOL_NAMES, someToolIsSideEffecting }
