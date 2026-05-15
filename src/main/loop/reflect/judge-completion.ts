// src/main/loop/reflect/judge-completion.ts
//
// Turn-end 二审 Reflector — main LLM 决 final 时, 调便宜 model 判 "真完成?"。
// complete=false + confidence≥0.5 → directOutput(endTurn=false), 落库 [reflection-judge],
// main LLM 下步通过 history 看到 pending items, 自然续做。
//
// 降级: code-filter 先过滤. 只有 final 文本含 "未来时承诺词" (I'll / Let me / 接下来 /
// 我会 / 还需要 ...) 时才调 LLM judge。监控显示 80%+ healthy final 是 complete=true 白调,
// hallucinated completion 通常伴随承诺词, 用关键词过滤可去掉 70%+ LLM 调用。
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

/**
 * 检测 final 文本是否含未来时承诺词. 命中表示 main LLM 说"完成"但同时承诺还要做事 —
 * 高概率是 hallucinated completion / 半成品 final, 值得调 LLM judge。
 *
 * 否则视为干净 final (例如 "查询返回 3 行: ..."), 直接放行, 节省 LLM 调用。
 */
function hasFutureCommitmentMarkers(text: string): boolean {
  const lower = text.toLowerCase()
  // 英文承诺词
  const en = [
    /\bi['']ll\b/, // I'll
    /\bi will\b/,
    /\blet me\b/,
    /\blet's\b/,
    /\bgoing to\b/,
    /\bgonna\b/,
    /\bwill (now |then |continue|proceed|next|also)/,
    /\babout to\b/,
    /\bnext step\b/,
    /\bneed to\b/,
    /\bstill need/,
    /\bwill be\b/,
  ]
  if (en.some((re) => re.test(lower))) return true
  // 中文承诺词 (大小写不敏感不适用, 用原文)
  const zh = ['接下来', '我会', '还需要', '即将', '准备', '下一步', '稍后', '然后我', '还要']
  return zh.some((kw) => text.includes(kw))
}

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

    // code-filter: final 不含未来时承诺词 → 视为 clean final, 跳过 LLM judge
    if (!hasFutureCommitmentMarkers(ctx.outcome.stepText)) {
      log.info(`[Reflect/judge-completion] clean final (no commitment markers), 跳过 LLM`)
      return null
    }

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
