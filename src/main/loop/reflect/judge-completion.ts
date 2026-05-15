// src/main/loop/reflect/judge-completion.ts
//
// Turn-end 二审 Reflector — main LLM 决 final 时, 调便宜 model 判 "真完成?"。
// complete=false + confidence≥0.5 → internalNudge(role=system), 落库为 system
// 监督指令但 UI 不渲染. main LLM 下步通过 history 把这条 system 消息识别为
// "系统级监督反馈", 续做指令性更强。
//
// 为什么 role=system 而不是 user/assistant:
//   - 不冒充用户 (history 不污染, prompt injection 攻击面更小)
//   - 不冒充 AI 自己 (避免连续 assistant 触发行为漂移 + UI 上"自己拆穿自己")
//   - system 是 reflect 真实身份 (系统级监督), 训练分布下主 LLM 视为权威指令
//
// 降级: code-filter 用多信号风险打分代替单一关键词检测. JudgeCompletion 的原始作用是
// 抓 "幻觉完成" (committed-to-but-no-tool-call), 信号设计围绕 intent ↔ trajectory 不匹配:
//
//   信号 A (+5): action verb intent + 0 工作量 (执行类请求但根本没动工具)
//   信号 B (+4): final 声称 IO (写入/保存/创建) 但 trajectory 无 write/edit
//   信号 C (+3): 多任务 intent (and / 、 / N 个 / 数字+量词) + tool calls 远少于任务数
//   信号 D (+2): 长复杂 intent (> 100 字) + 极短 final (< 50 字)
//
// 阈值 score >= 3 才调 LLM. healthy final (询问类 / 已工作的 final) 直接放行。
//
// maxPerTurn=2 上限: 同 turn 最多推翻 final 2 次, 第 3 次强制放行 (主循环 perTurnCounters)。
//
// 允许依赖: ./types, ./trajectory, ./agents/*, ../types
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectorCapabilities, ReflectorOutcome, ReflectContext } from './types'
import type { StepOutcome } from '../types'
import { summarizeTrajectory } from './trajectory'
import { runReflectAgent } from './agents/types'
import { JudgeCompletionAgent } from './agents/judge-completion-agent'

// 三类完整动词 + imperative 单字 (空格边界):
//   执行/写入/修改类 (中文): 查询/创建/写入/修改/删除/运行/执行/生成/编辑/搜索/查找/分析/审查/检查/读取
//   探索/查看类 (中文): 查看/看看/看下/看一下/看一遍/列出/列举/浏览/探索/总结/梳理/概览/比较/对比/罗列/展示
//   执行+探索类 (英文): build/create/write/modify/delete/run/exec/edit/search/find/grep/review/analyze/
//     inspect/fetch/fix/implement/refactor / look/list/show/browse/explore/summarize/compare/overview/enumerate
//   imperative 单字 (中文, 空格边界): 查/读/写/改/删/建/跑/找/看/列/总/搞/做
// 排除询问类 (不命中, 走询问路径): 解释/什么是/为什么 / what/why/how/explain
const ACTION_VERBS =
  /(查询|创建|写入|修改|删除|运行|执行|生成|编辑|搜索|查找|分析|审查|检查|读取|查看|看看|看下|看一下|看一遍|列出|列举|浏览|探索|总结|梳理|概览|比较|对比|罗列|展示|build|create|write|modify|delete|run|exec|edit|search|find|grep|review|analyze|inspect|fetch|fix|implement|refactor|look|list|show|browse|explore|summarize|compare|overview|enumerate|(?:^|\s|[,，;；:：])(?:查|读|写|改|删|建|跑|找|看|列|总|搞|做)\s)/i
const IO_CLAIM =
  /(wrote|saved|created|generated|written|输出到|写到|写入了|写入到|已写入|保存到|已保存|生成到|已生成|创建了|已创建)/i
const IO_TOOL = /^(write|edit|create|insert|update)$/i
// 多任务标记: 英文连接词 / 中文连接词 / 列表分隔 / 数字 + 量词 / 中文数字 + 量词
const MULTI_TASK_MARKERS =
  /( and |、|，|;|；|另外|还有|同时|此外|以及|\b\d+\s*(个|张|份|项|条|files?|tables?|items?)\b|[二三四五六七八九十]\s*(个|张|份|项|条))/gi

/**
 * 风险打分 — 信号叠加. score >= 3 触发 LLM judge.
 *
 * 设计原则: 信号必须对应"承诺-行动不匹配" / "intent-工作量不匹配" 的语义现象,
 * 不是表面关键词。每个信号独立成立, 多信号叠加增加置信度。
 */
function judgeRiskScore(
  userIntent: string,
  finalText: string,
  history: readonly StepOutcome[],
): { score: number; signals: string[] } {
  const signals: string[] = []
  let score = 0

  const totalTools = history.reduce((sum, o) => sum + o.toolNames.length, 0)
  const hasActionIntent = ACTION_VERBS.test(userIntent)

  // A: 执行类 intent + 零工作量 — 最强幻觉信号
  if (hasActionIntent && totalTools === 0) {
    score += 5
    signals.push(`action-intent + 0-tools`)
  }

  // B: final 声称 IO 操作但 trajectory 无对应 write/edit
  if (IO_CLAIM.test(finalText)) {
    const hasIOTool = history.some((o) => o.toolNames.some((t) => IO_TOOL.test(t)))
    if (!hasIOTool) {
      score += 4
      signals.push(`final-claims-IO + no-write-tool`)
    }
  }

  // C: 多任务 intent + 工作量不匹配
  const markerCount = (userIntent.match(MULTI_TASK_MARKERS) || []).length
  if (markerCount >= 1 && hasActionIntent && totalTools < markerCount + 1) {
    score += 3
    signals.push(`multi-task(${markerCount}) + tools(${totalTools})`)
  }

  // D: 长复杂 intent + 极短 final
  if (userIntent.length > 100 && finalText.length < 50) {
    score += 2
    signals.push(`long-intent(${userIntent.length}) + terse-final(${finalText.length})`)
  }

  return { score, signals }
}

const RISK_THRESHOLD = 3

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

    // code-filter: 多信号风险打分 — 低风险 final 直接放行
    const risk = judgeRiskScore(ctx.userIntent, ctx.outcome.stepText, ctx.recentHistory)
    if (risk.score < RISK_THRESHOLD) {
      log.info(`[Reflect/judge-completion] low risk score=${risk.score}, 跳过 LLM`)
      return null
    }
    log.info(
      `[Reflect/judge-completion] risk score=${risk.score} signals=[${risk.signals.join(', ')}], 调 LLM`,
    )

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
    // chain 注入的本次触发计数 (1-based) + capabilities.maxPerTurn 上限
    const idx = ctx.perTurnIndex ?? 1
    const max = ctx.perTurnLimit ?? this.capabilities.maxPerTurn ?? 2
    const counterTag = `${idx}/${max}`
    const lastChanceNote =
      idx >= max
        ? `\n\nNOTE: This is supervision check ${counterTag} — the final allowed. ` +
          `If you re-declare completion after this, it will pass through regardless.`
        : ''

    return {
      internalNudge: {
        text:
          `[Supervision check ${counterTag} — automated quality review, not user input]\n` +
          `Your previous turn declared completion, but supervision detected the following items remain pending:\n` +
          result.pendingItems.map((p) => '- ' + p).join('\n') +
          `\n\nReason: ${result.reason}\n\n` +
          `MANDATORY: Address these pending items in your next response. ` +
          `If a tool call is needed, issue it now. Do NOT re-declare completion until all items are resolved.` +
          lastChanceNote,
        label: '[reflection-judge]',
        reason: result.reason,
        // role=system: 主 LLM 视为系统级监督指令, 续做权威性 > 模拟用户/连续 assistant
        role: 'system',
      },
    }
  }
}
