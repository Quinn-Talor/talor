// src/main/loop/reflect/context-budget.ts
//
// Pre-step reflector: 在 streamText 之前检查 prompt token 预算。
//
// 三档 (纯代码判定, 零 LLM 调用):
//   ratio >= 1.0:     userOutput [auto-halt] 落库 + UI 渲染 + break (用户必看)。
//                     硬编码 message — context overflow 是 fast-fail 场景,
//                     LLM 友好措辞带来的边际价值不抵 +1 次 LLM 调用 + 延迟。
//   ratio > warnRatio: hint [CONTEXT NEARLY FULL] 注入本步 messages (主 LLM 看)。
//   else:             null (放行)。
//
// 允许依赖: ./types, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'

export interface ContextBudgetReflectorOpts {
  /** ratio 触发软告警阈值, 默认 0.98 */
  warnRatio?: number
}

export class ContextBudgetReflector implements Reflector {
  readonly name = 'context-budget'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['pre-step'],
    maxPerTurn: 1,
    priority: 10,
  }

  private readonly warnRatio: number

  constructor(opts: ContextBudgetReflectorOpts = {}) {
    this.warnRatio = opts.warnRatio ?? 0.98
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'pre-step') return null
    if (ctx.contextLimit <= 0) return null

    const ratio = ctx.estimatedTokens / ctx.contextLimit
    const pct = (ratio * 100).toFixed(0)

    if (ratio >= 1.0) {
      log.error(
        `[Reflect/context-budget] overflow ${ctx.estimatedTokens}/${ctx.contextLimit} (${pct}%)`,
      )
      const text =
        `Context window exceeded (${ctx.estimatedTokens}/${ctx.contextLimit} tokens, ${pct}%). ` +
        `Task stopped to avoid silent provider truncation. Please start a new session or trim history.`
      return {
        userOutput: {
          text,
          label: '[auto-halt]',
          exitReason: 'context_overflow',
          reason: `context overflow ${pct}%`,
        },
      }
    }

    if (ratio > this.warnRatio) {
      log.warn(
        `[Reflect/context-budget] near full ${ctx.estimatedTokens}/${ctx.contextLimit} (${pct}%)`,
      )
      return {
        hint:
          `[CONTEXT NEARLY FULL] Prompt is using ~${pct}% of the available window. ` +
          `Prefer concise responses and avoid large tool outputs. Finish any in-progress task first, then summarize.`,
      }
    }

    return null
  }
}
