// src/main/loop/turn-end-policies/pending-continuation.ts — P2: pending_continuation 主声明续做
//
// LLM 通过 pending_continuation block 主声明"我承诺还要做某事但本 step 没动手",
// 系统据此续 loop 并注入 reminder hint。
//
// 重要设计:
//   - hint 不解释 "你要做什么" — LLM 的前文已经说了 (e.g. "现在写入文档:"),
//     reminder 只让 LLM 回头看自己上一步说过什么
//   - 单一事实源原则:LLM 前文 = 续做意图的唯一表达,框架不二次 paraphrase
//
// 防滥用:连续 3 次 emit 此 block 而无 tool call → ContinuationChainDetector 触发 break
//
// 允许依赖: ./types, ../../../shared/talor-blocks/*
// 禁止依赖: ipc/*

import { parseTalorBlocks } from '@shared/talor-blocks/talor-block-parser'
import type { PolicyContext, TurnEndDecision, TurnEndPolicy } from './types'
import type { StepOutcome } from '../types'

/**
 * 续做提示。
 *
 * 故意通用 — 不引用 block 内任何字段 (block 也确实没必填字段)。
 * 引导 LLM 回头看自己上一步的 text,执行 commit 过的动作。
 */
const CONTINUATION_HINT =
  `Continuation reminder: your previous step ended with a pending_continuation block ` +
  `but no tool call. Look back at what you said in that step and execute the action ` +
  `you committed to. If you've changed your mind, emit done/blocked instead.`

export class PendingContinuationBlockPolicy implements TurnEndPolicy {
  readonly name = 'pending-continuation'

  async evaluate(outcome: StepOutcome, _ctx: PolicyContext): Promise<TurnEndDecision> {
    const { blocks } = parseTalorBlocks(outcome.stepText)
    const hasContinuation = blocks.some((b) => b.type === 'pending_continuation')
    if (!hasContinuation) {
      return { action: 'no-opinion', reason: 'no pending_continuation block' }
    }
    return {
      action: 'continue',
      exitReason: 'continuation_injected',
      injectHint: CONTINUATION_HINT,
      reason: 'LLM declared pending_continuation',
    }
  }
}
