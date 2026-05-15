// src/main/loop/reflect/judge-completion.ts
//
// Turn-end 二审 Reflector — main LLM 决 final 时, 调便宜 model 判 "真完成?"。
// complete=false + confidence≥0.5 → directOutput(endTurn=false), 落库 [reflection-judge],
// main LLM 下步通过 history 看到 pending items, 自然续做。
//
// maxPerTurn=2 上限: 同 turn 最多推翻 final 2 次, 第 3 次强制放行 (主循环 perTurnCounters)。
//
// 允许依赖: ./types, ./trajectory, ./agents/*, ../types
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import { summarizeTrajectory } from './trajectory'
import { runReflectAgent } from './agents/types'
import { JudgeCompletionAgent } from './agents/judge-completion-agent'

export interface JudgeCompletionReflectorOpts {
  sessionId: string
}

export class JudgeCompletionReflector implements Reflector {
  readonly name = 'judge-completion'
  readonly capabilities: ReflectorCapabilities = {
    phases: ['turn-end'],
    maxPerTurn: 2,
  }

  constructor(_opts: JudgeCompletionReflectorOpts) {
    // sessionId 当前由 ctx 提供, opts 保留以便将来加配置 (e.g. confidence threshold)。
    void _opts
  }

  async reflect(ctx: ReflectContext): Promise<ReflectorOutcome | null> {
    if (ctx.phase !== 'turn-end') return null
    if (ctx.outcome.toolNames.length > 0 || !ctx.outcome.stepText) return null

    const result = await runReflectAgent(
      JudgeCompletionAgent,
      {
        userIntent: ctx.userIntent,
        finalText: ctx.outcome.stepText,
        trajectory: summarizeTrajectory(ctx.recentHistory),
      },
      ctx.reflectModel,
      ctx.abortSignal,
    )

    if (!result) return null
    if (result.complete) {
      log.info(`[Reflect/judge-completion] complete=true (放行 final)`)
      return null
    }
    if (result.confidence < 0.5) {
      log.info(`[Reflect/judge-completion] confidence ${result.confidence} < 0.5, 丢弃`)
      return null
    }
    log.warn(
      `[Reflect/judge-completion] complete=false (推翻 final), pending=${result.pendingItems.length}`,
    )
    return {
      directOutput: {
        text:
          `You declared completion, but the following items are pending:\n` +
          result.pendingItems.map((p) => '- ' + p).join('\n') +
          `\nReason: ${result.reason}\nPlease continue addressing them.`,
        label: '[reflection-judge]',
        endTurn: false,
        reason: result.reason,
      },
    }
  }
}
