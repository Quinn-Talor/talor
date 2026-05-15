// src/main/loop/turn-end-policies/sdk-finish-reason.ts — P0: SDK finishReason 优先消费
//
// AI SDK 给的 finishReason 是 LLM / provider 的自陈信号 (§J-SHOULD-3 类别 A),
// 作为 turn-end 决策的最高优先级信号, 而非靠 stepToolCalls.length + stepText
// 启发推断。
//
// 各 finishReason 处理:
//   - 'tool-calls':       不该走到这里 (react-loop 在 stepToolCalls>0 时直接续 loop,
//                          不进 turn-end policy 链);若意外走到,返 no-opinion 兜底
//   - 'length':           max_tokens 截断 → 自动 continue + 注入 truncation hint
//                          (不需要 judge 二审,SDK 已经告诉我们模型没说完)
//   - 'content-filter':   provider 安全策略拒绝 → final + exitReason='content_filter'
//   - 'stop':             模型自然停 → no-opinion (交给后续 policy 判 done block / judge)
//   - 'error'/'other'/'unknown': 异常但非已知截断 → no-opinion (fail-open)
//
// 允许依赖: ./types, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { PolicyContext, TurnEndDecision, TurnEndPolicy } from './types'
import type { StepOutcome } from '../types'

/**
 * Max_tokens 截断时注入给 LLM 的 hint。
 *
 * 重点:
 *   - 明确告诉 LLM "上一步被 provider 截断了" (不是模型自己说完了)
 *   - 要求 continue from where you left off (不重复)
 *   - 提示长输出场景(file write / long markdown)应拆分,避免再次截断
 */
const TRUNCATION_HINT =
  `Your previous response was truncated by the provider's max_tokens limit ` +
  `(output budget exhausted). To recover:\n` +
  `  1. If you intended to produce a LARGE ARTIFACT (file content, long markdown, ` +
  `code block, table dump): STOP inlining it in chat. Use the \`write\` or \`edit\` ` +
  `tool to write it to a file. Tool inputs have separate, much larger budgets than ` +
  `chat output.\n` +
  `  2. If you were generating a normal response, continue from where you left off ` +
  `without repeating already-produced content.\n` +
  `  3. If your reasoning chain is consuming output tokens before reaching tool ` +
  `calls: be more concise. Skip extensive planning text and act with the tool ` +
  `directly.`

export class SdkFinishReasonPolicy implements TurnEndPolicy {
  readonly name = 'sdk-finish-reason'

  async evaluate(_outcome: StepOutcome, ctx: PolicyContext): Promise<TurnEndDecision> {
    const reason = ctx.sdkSignals.finishReason

    switch (reason) {
      case 'tool-calls':
        // 工具路径不该走到 turn-end policy (react-loop step-end 判 stepToolCalls.length>0 时
        // 直接续 loop)。若意外走到,fail-open 给下一层。
        return {
          action: 'no-opinion',
          reason:
            'finishReason=tool-calls but reached turn-end chain (unexpected, falling through)',
        }

      case 'length':
        log.info(
          `[SdkFinishReasonPolicy] finishReason='length' detected, injecting truncation hint`,
        )
        return {
          action: 'continue',
          exitReason: 'truncated',
          injectHint: TRUNCATION_HINT,
          reason: `finishReason='length' (max_tokens hit)`,
        }

      case 'content-filter':
        log.warn(`[SdkFinishReasonPolicy] finishReason='content-filter' — provider blocked output`)
        return {
          action: 'final',
          exitReason: 'content_filter',
          reason: 'provider content filter triggered',
        }

      case 'error':
      case 'other':
        // 异常但非截断 — 不能强行 final 或 continue,fail-open 让下一层决定
        return {
          action: 'no-opinion',
          reason: `finishReason='${reason}', falling through`,
        }

      case 'stop':
      default:
        // 'stop' 是最常见情况 — 模型主声明停。
        // 但"停"不代表"任务完成":可能是真完成 (后续 ExplicitTerminationBlockPolicy 命中 done block)
        // 也可能是 promise-then-stop (后续 JudgePolicy 兜底)。
        // 所以这里 no-opinion,把决策权让给后续 policy。
        // default 兜底:未来 SDK 新增 FinishReason 值时(e.g. 'unknown' 重新加入),
        // 也 fail-open 不阻塞主路径。
        return {
          action: 'no-opinion',
          reason: `finishReason='${reason}', falling through to block/judge layers`,
        }
    }
  }
}
