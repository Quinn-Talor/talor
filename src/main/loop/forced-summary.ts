// src/main/loop/forced-summary.ts —— 业务层: 统一的"强制摘要"执行器
//
// 合并原 3 个函数 (runFallbackSummary / runFailureStreakSummary / runForcedClosureSummary)
// 的共同流程: build prompt → streamText 禁工具 → 净化三件套 → 落库带 label。
//
// 三个 OPTS 常量工厂分别对应三类触发场景:
//   - FALLBACK_SUMMARY_OPTS:        整轮无 text 时兜底
//   - failureStreakSummaryOpts(N):  连续 N 次工具失败时兜底
//   - forcedClosureSummaryOpts(N):  连续 N 次无 Rule 13 marker 时兜底
//
// 允许依赖: ./types, ../repos/session-repo, ./quote-verifier
// 禁止依赖: ipc/*

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { streamText, type ModelMessage } from 'ai'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { buildStreamSignal } from './stream-utils'
import { verifyQuotedFacts, verifyEntityGrounding } from './quote-verifier'
import { hasTerminationMarker } from './outcome-facts'

const SEPARATOR = '──────────────────────────────────────────'

/**
 * 收集最近 k 条 tool 角色消息的 raw output 文本, 供 verifyQuotedFacts 比对。
 *
 * 为什么从后往前扫: 兜底摘要最相关的证据是"刚跑过的工具", 越早的越次要;
 * 取 k 条后就停, 避免对已存档的历史 session 做全量读取。
 */
function collectRecentToolOutputs(sessionId: string, k: number): string[] {
  const all = messageRepo.listBySession(sessionId)
  const outputs: string[] = []
  for (let i = all.length - 1; i >= 0 && outputs.length < k; i--) {
    if (all[i].role !== 'tool') continue
    try {
      const blocks = JSON.parse(all[i].content) as Array<{ type: string; output?: string }>
      for (const b of blocks) {
        if (b.type === 'tool_result' && typeof b.output === 'string' && b.output.length > 0) {
          outputs.push(b.output)
          if (outputs.length >= k) break
        }
      }
    } catch {
      // 非 blocks 格式的旧消息, 跳过
    }
  }
  return outputs
}

/**
 * 清洗 fallback / failure-recovery / forced-closure 输出中泄漏的工具调用 markup。
 *
 * Failure-recovery / forced-closure 模式下工具被禁用, 但模型仍可能把 tool_use
 * 风格 markup 当文本输出 (DSML / invoke / parameter / tool_calls)。直接显示
 * 给用户混乱。
 *
 * 支持的 markup 形式 (历史踩坑总结):
 *   1. ASCII pipe:   <||DSML||tool_calls>
 *   2. 全角 pipe:    <｜｜DSML｜｜tool_calls>  (U+FF5C FULLWIDTH VERTICAL LINE)
 *      — deepseek / qwen 等中文模型常输出全角变体
 *   3. XML 标签:     <invoke> / <parameter> / <tool_call> / <tool_calls> / <tool_use>
 *
 * 替换策略: 把 markup 标签替换为 ⟨tool-call-attempt⟩ 占位, 不直接删除以保留
 * "曾尝试调工具"的事实信号。
 *
 * 不导出 (内部 helper); 任何 forced-summary 路径都应通过 runForcedSummary
 * 间接调用,以保证 strip 一定被执行。
 */
export function stripToolCallMarkup(text: string): string {
  if (!text) return text
  // ASCII pipe 变体 <||...>
  let out = text.replace(/<\|\|[^>]*>/g, '⟨tool-call-attempt⟩')
  // 全角 pipe 变体 <｜｜...>  (中文模型常输出)
  out = out.replace(/<｜｜[^>]*>/g, '⟨tool-call-attempt⟩')
  // XML 标签 (含可选属性 / 闭合斜杠)
  out = out.replace(/<\/?(?:invoke|parameter|tool_call|tool_calls|tool_use)\b[^>]*>/gi, '')
  // 连续多个占位符合并为一个,降低噪声
  out = out.replace(/(?:⟨tool-call-attempt⟩\s*){2,}/g, '⟨tool-call-attempt⟩ ')
  return out
}

/**
 * 兜底摘要执行所需的最小 StepContext 切片。
 * 不直接依赖 react-loop 的 StepContext (避免循环依赖)。
 */
export interface ForcedSummaryCtx {
  sessionId: string
  userContent: string
  mappedAttachments: Array<{ name: string; mediaType: string; base64?: string }>
  abortSignal: AbortSignal
  pipeline: import('../prompt/PromptPipeline').PromptPipeline
  provider: import('../store/config-store').Provider
  providerConfig: import('../prompt/types').ProviderContextConfig
  workspace: string
  model: import('ai').LanguageModel
  agent: import('../agent/agent').Agent
  agentId: string
  skillTracker: import('../skills/registry').SkillActivationTracker
  events: import('../chat/events').ExecutionEventBus
  callbacks: { onTextDelta: (delta: string, stepIndex: number) => void }
}

export interface ForcedSummaryOpts {
  /** 日志前缀 (e.g. 'fallback summary' / 'failure-streak' / 'forced-closure') */
  logName: string
  /** Guardrail system message (注入到 messages 末尾, 禁工具语境) */
  guardrail: ModelMessage
  /** 输出消息前缀 label, 不含 verify tag (e.g. '[auto-summary]' / '[failure-recovery]' / '[forced-closure]') */
  label: string
  /** 是否在输出文本上运行 verify-quote / verify-entity / strip-markup 三件套 */
  applyVerification: boolean
  /** 模型空输出时的兜底文案; undefined → 空文本时直接跳过落库 (fallback summary 行为) */
  fallbackTextIfEmpty?: string
  /** 输出文本的后处理 (forced-closure 用来补 ⏸ Blocked) */
  postProcess?: (text: string) => string
  /** catch 块落库的兜底文案 (内部错误兜底) */
  errorFallbackText: string
}

/**
 * 统一的"强制摘要"执行流程。
 *
 * 步骤:
 *   1. pipeline.build 构造 prompt
 *   2. streamText 禁工具 + 注入 guardrail → 流式累积 summaryText
 *   3. (applyVerification=true 时) verifyQuotedFacts + verifyEntityGrounding + stripToolCallMarkup
 *   4. postProcess (forced-closure 补 marker)
 *   5. 落库带 label + 可能的 verify tag
 *
 * 异常路径: catch 块落 errorFallbackText 兜底, 保证用户至少看到一条消息。
 */
export async function runForcedSummary(
  ctx: ForcedSummaryCtx,
  stepIndex: number,
  opts: ForcedSummaryOpts,
): Promise<void> {
  log.info(`[ReactLoop] ${SEPARATOR} ${opts.logName} ${SEPARATOR}`)
  const summaryStart = Date.now()

  try {
    const summaryPipelineCtx = {
      sessionId: ctx.sessionId,
      currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      workspacePath: ctx.workspace || undefined,
      agent: ctx.agent,
      skillTracker: ctx.skillTracker,
      events: ctx.events,
    }
    const { messages } = await ctx.pipeline.build(summaryPipelineCtx)
    const summaryResult = streamText({
      model: ctx.model,
      messages: [...messages, opts.guardrail],
      abortSignal: buildStreamSignal(ctx.abortSignal),
    })

    let summaryText = ''
    for await (const chunk of summaryResult.textStream) {
      summaryText += chunk
      ctx.callbacks.onTextDelta(chunk, stepIndex)
    }

    const durationMs = Date.now() - summaryStart

    // 空文本路径
    if (!summaryText.trim() && opts.fallbackTextIfEmpty === undefined) {
      log.info(`[ReactLoop]   → ${opts.logName}: empty [${durationMs}ms]`)
      return
    }
    const baseText = summaryText.trim() || (opts.fallbackTextIfEmpty as string)

    // Verify 三件套 (可选 — 仅 quote / entity 校验受 applyVerification 控制)
    let cleaned = baseText
    const verifyTags: string[] = []
    if (opts.applyVerification) {
      const toolOutputs = collectRecentToolOutputs(ctx.sessionId, 10)
      const r1 = verifyQuotedFacts(baseText, toolOutputs)
      const r2 = verifyEntityGrounding(r1.cleaned, {
        instruction: ctx.userContent,
        toolOutputs,
      })
      cleaned = r2.cleaned

      if (r1.unverifiedCount > 0) {
        log.warn(
          `[ReactLoop]   ${opts.logName}: masked ${r1.unverifiedCount} unverifiable quote(s)`,
        )
        verifyTags.push(
          `${r1.unverifiedCount} unverifiable quote${r1.unverifiedCount > 1 ? 's' : ''} masked`,
        )
      }
      if (r2.ungroundedCount > 0) {
        log.warn(
          `[ReactLoop]   ${opts.logName}: masked ${r2.ungroundedCount} ungrounded entity reference(s)`,
        )
        verifyTags.push(
          `${r2.ungroundedCount} ungrounded entit${r2.ungroundedCount > 1 ? 'ies' : 'y'} masked`,
        )
      }
    }

    // strip markup 永远跑 — forced-* 模式禁工具, 任何 tool-call markup 都是无效的,
    // 必须剥, 否则模型尝试 DSML / invoke / XML 都会原封显示给用户 (本次 bug)。
    cleaned = stripToolCallMarkup(cleaned)

    // postProcess (forced-closure 用 — 补 ⏸ Blocked 等)
    if (opts.postProcess) cleaned = opts.postProcess(cleaned)

    // 组装最终 label + 落库
    const finalLabel =
      verifyTags.length > 0
        ? `${opts.label.replace(/]$/, '')} • ${verifyTags.join('; ')}]`
        : opts.label
    const markedText = `${finalLabel}\n${cleaned}`

    messageRepo.create({
      id: uuidv4(),
      session_id: ctx.sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: markedText }],
      agent_id: ctx.agentId,
    })
    sessionRepo.touch(ctx.sessionId)
    log.info(`[ReactLoop]   → ${opts.logName}: ${cleaned.length} chars [${durationMs}ms]`)
  } catch (err) {
    log.error(`[ReactLoop]   → ${opts.logName} failed [${Date.now() - summaryStart}ms]:`, err)
    // 兜底兜底: summary 自身失败时落 errorFallbackText, 保证用户看到消息
    try {
      messageRepo.create({
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: opts.errorFallbackText }],
        agent_id: ctx.agentId,
      })
      sessionRepo.touch(ctx.sessionId)
    } catch (persistErr) {
      log.error(`[ReactLoop]   ${opts.logName} fallback persist failed:`, persistErr)
    }
  }
}

// ─── 三类 OPTS 工厂 ─────────────────────────────────────────────────────

const FALLBACK_GUARDRAIL: ModelMessage = {
  role: 'system',
  content:
    '[Fallback summary mode — SILENCE IS NOT ALLOWED]\n' +
    'You just made tool calls but produced no text output. The user is waiting and sees nothing. ' +
    'You MUST output text in this turn. Empty response is forbidden. ' +
    'Report to the user what you did and what was observed, ' +
    '**using only the content inside the <tool_output> tags above**. Strict rules:\n' +
    '1. Do not call any tools.\n' +
    '2. Do not invent facts, paths, file names, or numbers that did not appear in tool_output.\n' +
    '3. If any tool returned an error (File not found / [exit: non-zero] / ERROR / missing_scope / etc.), ' +
    'state the failure verbatim AND quote the exact error message. Do not pretend it succeeded.\n' +
    '4. If the tool results are insufficient for a meaningful answer, say explicitly: "Task not completed because ...".\n' +
    '5. If you genuinely have nothing to say, you MUST still output the single sentence: ' +
    '"I have no useful output to provide here. The last tool result was: <one-line summary>. Please advise." ' +
    'Silence is a bug. Always speak.',
}

const FAILURE_STREAK_GUARDRAIL: ModelMessage = {
  role: 'system',
  content:
    '[Tool failure recovery mode]\n' +
    'You just had 3 consecutive tool calls that all failed. To prevent further wasted attempts, ' +
    'tools are now disabled for this final response. You MUST output text explaining to the user:\n' +
    '1. What you were trying to accomplish.\n' +
    '2. Each tool call you made and the verbatim error it returned.\n' +
    '3. Why you believe it kept failing (e.g., file does not exist, missing permission, wrong path).\n' +
    '4. What the user can do next (provide more info / different approach / accept partial result).\n' +
    'Quote error text exactly as it appeared in <tool_output>. Do not invent facts. Do not pretend ' +
    'anything succeeded. If you genuinely have nothing useful to say, output the single sentence: ' +
    '"I was unable to complete the task because <verbatim summary of last tool error>. Please advise."',
}

/** Fallback summary (空文本整轮兜底)。空 text 时不落库 — 与原 runFallbackSummary 行为一致。 */
export const FALLBACK_SUMMARY_OPTS: ForcedSummaryOpts = {
  logName: 'fallback summary',
  guardrail: FALLBACK_GUARDRAIL,
  label: '[auto-summary]',
  applyVerification: true,
  fallbackTextIfEmpty: undefined,
  errorFallbackText: '[auto-summary failed] Internal error generating fallback summary.',
}

/** Failure-streak summary (连续工具失败兜底)。 */
export function failureStreakSummaryOpts(failureCount: number): ForcedSummaryOpts {
  return {
    logName: `failure-streak summary (count=${failureCount})`,
    guardrail: FAILURE_STREAK_GUARDRAIL,
    label: '[failure-recovery]',
    applyVerification: true,
    fallbackTextIfEmpty: `I was unable to complete the task after ${failureCount} consecutive tool failures. Please advise.`,
    errorFallbackText: `[auto-halt] Task blocked by ${failureCount} consecutive tool failures. Please review the errors above and provide guidance.`,
  }
}

/** Signature dead-loop summary (同 tool+input+output 重复触发兜底)。 */
export function signatureDeadLoopSummaryOpts(
  signature: string,
  repeatCount: number,
  isError: boolean,
): ForcedSummaryOpts {
  const SIGNATURE_DEAD_LOOP_GUARDRAIL: ModelMessage = {
    role: 'system',
    content:
      `[Signature dead-loop recovery mode]\n` +
      `You called the SAME tool with the SAME inputs and got the SAME ` +
      `${isError ? 'error' : 'result'} ${repeatCount + 1} times in a row. ` +
      `Continuing would waste resources. Tools are now DISABLED for this final ` +
      `response. You MUST output text explaining to the user:\n` +
      `1. The exact tool + input you kept repeating (signature: ${signature}).\n` +
      `2. The verbatim ${isError ? 'error' : 'output'} from the most recent tool result.\n` +
      `3. Why you believe the tool kept ${isError ? 'rejecting' : 'returning the same answer'} ` +
      `(e.g., wrong syntax/dialect, missing permission, malformed argument, ` +
      `or task is genuinely impossible with this tool).\n` +
      `4. What the user can do next (different approach, manual workaround, ask for help).\n` +
      `Quote the error/output text exactly. Do not invent facts. Do not pretend it worked. ` +
      `End your reply with one of:\n` +
      `  ❓ Need input — <what specific info / decision you need from user>\n` +
      `  ⏸ Blocked — <the blocker preventing further progress>`,
  }

  return {
    logName: `signature dead-loop summary (sig=${signature.slice(0, 20)}…, count=${repeatCount + 1}, isError=${isError})`,
    guardrail: SIGNATURE_DEAD_LOOP_GUARDRAIL,
    label: '[signature-dead-loop]',
    applyVerification: true,
    fallbackTextIfEmpty: `I kept calling the same tool with the same input ${repeatCount + 1} times and got the same ${isError ? 'error' : 'result'}. Please advise.`,
    errorFallbackText: `[signature-dead-loop failed]\n⏸ Blocked — internal error during dead-loop recovery (signature repeated ${repeatCount + 1}x). Please retry with different approach.`,
  }
}

/** Forced-closure summary (连续无 Rule 13 marker 兜底)。 */
export function forcedClosureSummaryOpts(noMarkerCount: number): ForcedSummaryOpts {
  const FORCED_CLOSURE_GUARDRAIL: ModelMessage = {
    role: 'system',
    content:
      `[Forced closure mode]\n` +
      `You have ended ${noMarkerCount} consecutive replies without a tool call AND without ` +
      `any termination marker. Tools are now DISABLED for this final response.\n\n` +
      `⛔ DO NOT output tool-call markup of any kind (e.g. <DSML> / <invoke> / <tool_call> / ` +
      `<｜｜DSML｜｜...> / <parameter>). Tools are disabled — any markup will be stripped from ` +
      `your reply before it reaches the user. Real tool calls cannot happen in this mode.\n\n` +
      `You MUST output text whose LAST line is one of:\n` +
      `  ✓ Done — <one-line summary of what was accomplished, based on the conversation above>\n` +
      `  ❓ Need input — <one sentence on exactly what you need the user to provide ` +
      `(e.g. "the correct SQL dialect for listing tables in the mysql MCP tool")>\n` +
      `  ⏸ Blocked — <one sentence on the specific blocker, quoting the relevant error if any>\n\n` +
      `Pick the marker that honestly reflects the state. If you were mid-task and need to ` +
      `defer to the user, prefer ❓ Need input over ⏸ Blocked. Do NOT add any text after the ` +
      `marker line. Do NOT invent facts not present in the conversation.`,
  }

  return {
    logName: `forced closure (no-marker count=${noMarkerCount})`,
    guardrail: FORCED_CLOSURE_GUARDRAIL,
    label: '[forced-closure]',
    applyVerification: false, // 与原 runForcedClosureSummary 一致, 不做 quote-verify
    fallbackTextIfEmpty: 'Cannot determine task state.',
    postProcess: (text) =>
      hasTerminationMarker(text)
        ? text
        : `${text}\n\n⏸ Blocked — model failed to provide explicit closure after ${noMarkerCount} attempts; please re-engage.`,
    errorFallbackText: `[forced-closure failed]\n⏸ Blocked — internal error during forced closure after ${noMarkerCount} no-marker attempts. Please retry.`,
  }
}
