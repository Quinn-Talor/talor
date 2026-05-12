// src/main/loop/detectors/hallucinated-confirm.ts —— 业务层: 语义一致性 Detector
//
// v3.6 L2 SemanticDetector — 捕捉"幻觉确认"反模式:
//   模型文本声称"用户已确认 / 已批准 / 收到授权"等,但本步实际没有 pending_confirm
//   block 也没有从 memory 自动通过的迹象 → 模型在编造确认事件。
//
// 触发条件 (全部满足):
//   1. stepText 含"用户已确认"信号 (中英双语 regex)
//   2. 本步没有 pending_confirm block (说明也没走主路径 confirm)
//   3. 本步实际有工具调用 (无工具就是纯叙述,不算"基于伪造确认执行")
//
// 触发动作: 非破坏性 — 注入 hint 警告模型"不要编造确认",鼓励 pending_confirm
// 主路径。下一步若仍幻觉,signature-dead-loop / no-marker 接管硬阻断。
//
// 注: detector 拿不到"是否走过 memory 自动批准"的全局信号 (memory 走 RiskGate
// 私域),所以判定上保留少量误报率 — 但 hint 文案足够"软纠偏",误报代价低。
//
// 允许依赖: ./types, ../outcome-facts
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LoopDetector, DetectorVerdict, DetectorRawContext } from './types'
import { NO_TRIGGER } from './types'
import type { OutcomeFacts } from '../outcome-facts'

/**
 * 幻觉确认意图的通用 regex (中英双语)。
 *
 * 设计原则: 仅捕捉"模型主动声称已得到批准"的表述, 不包括客观叙述
 * (e.g. "用户尚未确认" / "等待用户确认中" → 这类不触发)。
 */
const HALLUCINATED_CONFIRM_PATTERNS: RegExp[] = [
  /\b(?:user\s+(?:has\s+)?(?:confirmed|approved|authorized|consented|agreed))\b/i,
  /\b(?:approval\s+(?:received|granted|obtained))\b/i,
  /\bconfirmation\s+(?:received|granted)\b/i,
  /\b(?:got|received)\s+(?:user\s+)?(?:confirmation|approval|authorization|consent)\b/i,
  /(?:用户|您)(?:已|已经)(?:确认|批准|授权|同意|允许|许可)/,
  /(?:已|已经)(?:获得|得到|收到)(?:用户|您)?(?:的)?(?:确认|批准|授权|同意|许可)/,
  /(?:确认|批准|授权)(?:已|已经)?(?:通过|完成|生效|收到)/,
]

const HALLUCINATED_CONFIRM_HINT =
  '[Hallucinated confirmation] Your reply claims the user confirmed / approved / authorized ' +
  'something, but the framework did NOT see a confirmation event for this step. Either:\n' +
  '  (a) The user genuinely did not confirm yet — drop that wording. Use a `pending_confirm` ' +
  'block in the SAME step as the side-effecting tool call to surface a real confirmation ' +
  'dialog to the user.\n' +
  '  (b) Confirmation was previously approved-with-remember in this session — fine, but state ' +
  'that explicitly ("auto-approved by session pattern: <key>") instead of pretending the user ' +
  'just confirmed.\n' +
  '\nDo NOT fabricate confirmations to bypass the safety dialog.'

/** 检查 stepText 是否含"幻觉确认"意图。 */
export function hasHallucinatedConfirm(text: string): boolean {
  if (!text) return false
  for (const re of HALLUCINATED_CONFIRM_PATTERNS) {
    if (re.test(text)) return true
  }
  return false
}

/**
 * Hallucinated Confirm detector。
 *
 * 命中后只发 hint, 不 break — 软纠偏。下一步若仍编造,Phase 1B 死循环侦测接管。
 */
export class HallucinatedConfirmDetector implements LoopDetector {
  readonly name = 'hallucinated-confirm'

  private triggered = false

  observe(facts: OutcomeFacts, _stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict {
    this.triggered = false

    if (!raw) return NO_TRIGGER
    if (!facts.hasToolCall) return NO_TRIGGER
    // 已有 pending_confirm block → 模型走主路径 confirm,不是幻觉
    if (facts.hasPendingConfirm) return NO_TRIGGER

    if (!hasHallucinatedConfirm(raw.stepText)) return NO_TRIGGER

    log.warn(
      '[HallucinatedConfirm] detected — stepText claims user confirmed but no pending_confirm block',
    )
    this.triggered = true
    return NO_TRIGGER
  }

  nextHint(): string | null {
    return this.triggered ? HALLUCINATED_CONFIRM_HINT : null
  }
}

/** 测试用 export (内部 helper) */
export const __TEST__ = { hasHallucinatedConfirm }
