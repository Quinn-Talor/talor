// src/main/loop/reflect/context-budget.ts
//
// Pre-step reflector: 在 streamText 之前检查 prompt token 预算。
//
// 三档:
//   ratio >= 1.0:     directOutput(endTurn=true) [auto-halt] 落库 + break。
//                     若 reflectModel 配置, 调 FriendlyHaltAgent 产出友好文案;
//                     否则硬编码兜底 message。
//   ratio > warnRatio: hint [CONTEXT NEARLY FULL] 注入本步 messages (PreReflector
//                     的 hint 由主循环 push 到 messages 末尾)。
//   else:             null (放行)。
//
// 允许依赖: ./types, ./agents/*, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import { runReflectAgent } from './agents/types'
import { FriendlyHaltAgent } from './agents/friendly-halt-agent'

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
      let friendly: string | null = null
      if (ctx.reflectModel) {
        const r = await runReflectAgent(
          FriendlyHaltAgent,
          {
            userIntent: ctx.userIntent,
            estimatedTokens: ctx.estimatedTokens,
            contextLimit: ctx.contextLimit,
          },
          ctx.reflectModel,
          ctx.abortSignal,
        )
        friendly = r?.friendlyMessage ?? null
      }
      const text = friendly
        ? friendly
        : `Context window exceeded (${ctx.estimatedTokens}/${ctx.contextLimit} tokens, ${pct}%). ` +
          `Task stopped to avoid silent provider truncation. Please start a new session or trim history.`
      return {
        directOutput: {
          text,
          label: '[auto-halt]',
          endTurn: true,
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
