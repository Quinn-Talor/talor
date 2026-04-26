// src/main/loop/react-loop.ts —— 业务层：ReAct 多步推理引擎
//
// 公开接口：runReactLoop(opts)
//
// 内部结构：
//   runReactLoop          —— 顶层循环 + 兜底摘要调度
//   └── runReactStep      —— 单步 ReAct（build prompt → stream → persist）
//   └── runFallbackSummary —— 循环结束但零文本输出时的兜底
//
// 允许依赖：loop/*、repos/*、shared/*
// 禁止依赖：ipc/*

import { streamText, type LanguageModel } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { toolResultPartsToBlocks, buildStreamSignal } from './stream-utils'
import type { ReactLoopOptions, ReactLoopCallbacks } from './types'
import type { ContentBlock } from '@shared/types/message'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'

const DEFAULT_MAX_STEPS = 1000

const SEPARATOR = '──────────────────────────────────────────'
const DOUBLE_SEPARATOR = '══════════════════════════════════════════'

// ── 内部类型 ────────────────────────────────────────────────────────────

/** 单步 ReAct 所需的全部上下文（从 ReactLoopOptions 投射，去掉 maxSteps 等循环级参数）。 */
interface StepContext {
  model: LanguageModel
  tools: ReactLoopOptions['tools']
  sessionId: string
  messageId: string
  userContent: string
  mappedAttachments: ReactLoopOptions['mappedAttachments']
  abortSignal: AbortSignal
  pipeline: PromptPipeline
  provider: Provider
  providerConfig: ProviderContextConfig
  workspace: string
  callbacks: ReactLoopCallbacks
}

/** runReactStep 返回值——循环控制层据此决定是否继续。 */
interface StepOutcome {
  /** 本步产生的纯文本（供兜底判断 fullText 是否为空） */
  stepText: string
  /** 本步是否有工具调用 */
  hadToolCalls: boolean
  /** 是否已写入最终 assistant 消息（有 text 且无工具调用 → true） */
  wroteAssistantFinal: boolean
  /** 是否应继续下一步（工具调用且有 toolResults 时为 true） */
  shouldContinue: boolean
  /** 本步耗时（毫秒） */
  durationMs: number
  /** 本步调用的工具名列表 */
  toolNames: string[]
  /** 循环终止原因（仅当 shouldContinue=false 时有值） */
  exitReason?: LoopExitReason
}

/** 循环终止原因枚举。写入终局日志，方便排查为什么停下来。 */
type LoopExitReason =
  | 'no_tool_calls'       // 模型不再调用工具（正常终态）
  | 'empty_text'          // 模型既无工具调用也无文本（触发兜底）
  | 'empty_tool_results'  // SDK 返回了 tool-call 但 toolResults 为空（异常保护）
  | 'abort'               // 调用方主动中止
  | 'max_steps'           // 达到步数上限
  | 'fallback_summary'    // 兜底摘要触发
  | 'stream_error'        // consumeStream 异常

// ── runReactStep ────────────────────────────────────────────────────────

/**
 * 单步 ReAct。
 *
 * 流程：
 *   1. pipeline.build 构造当步 messages（含最新 memory、工具调用历史）
 *   2. streamText 启动，同步通过 onChunk 回调把 text-delta / tool-call / tool-result
 *      透传给上层（orchestrator → ipc → 渲染端）
 *   3. await consumeStream 等流结束
 *   4. 按本步是否有工具调用决定落库策略和返回值：
 *
 *      | 场景 | 落库 | wroteAssistantFinal | shouldContinue |
 *      |------|------|---------------------|----------------|
 *      | 无工具 + 有文本 | 1 条 assistant（text） | true | false |
 *      | 无工具 + 无文本 | 不写 | false | false |
 *      | 有工具 + toolResults 非空 | assistant(text+tool_use) + tool | false | true |
 *      | 有工具 + toolResults 为空 | 不写（异常保护） | false | false |
 */
async function runReactStep(ctx: StepContext, stepIndex: number, maxSteps: number): Promise<StepOutcome> {
  const stepStart = Date.now()

  const pipelineCtx = {
    sessionId: ctx.sessionId,
    currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    workspacePath: ctx.workspace || undefined,
  }
  const { messages } = await ctx.pipeline.build(pipelineCtx)

  log.info(`[ReactLoop] ${SEPARATOR} step ${stepIndex + 1}/${maxSteps} ${SEPARATOR}`)
  log.info(`[ReactLoop]   messages: ${messages.length} | provider: ${ctx.provider.name}`)

  const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
  let stepText = ''

  const result = streamText({
    model: ctx.model,
    messages,
    tools: ctx.tools,
    abortSignal: buildStreamSignal(ctx.abortSignal),
    onChunk({ chunk }) {
      if (chunk.type === 'text-delta') {
        stepText += chunk.text
        if (chunk.text.length > 0) ctx.callbacks.onTextDelta(chunk.text)
      } else if (chunk.type === 'tool-call') {
        stepToolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input })
        ctx.callbacks.onToolCall(chunk.toolCallId, chunk.toolName, chunk.input)
      } else if (chunk.type === 'tool-result') {
        ctx.callbacks.onToolResult(chunk.toolCallId, chunk.toolName, chunk.output)
      }
    },
    onError({ error }) {
      log.error('[ReactLoop]   stream error:', error)
    },
  })

  try {
    await result.consumeStream()
  } catch (streamErr) {
    const durationMs = Date.now() - stepStart
    log.error(`[ReactLoop]   consumeStream failed (${durationMs}ms):`, streamErr)
    throw streamErr
  }

  const durationMs = Date.now() - stepStart
  const toolNames = stepToolCalls.map(tc => tc.toolName)

  // 无工具调用 → 本次推理结束（正常终态）
  if (stepToolCalls.length === 0) {
    if (stepText) {
      log.info(`[ReactLoop]   → text: ${stepText.length} chars (no tools) [${durationMs}ms]`)
      log.info(`[ReactLoop]   → persist: assistant(text) [FINAL]`)
      messageRepo.create({
        id: ctx.messageId,
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: stepText }],
      })
      sessionRepo.touch(ctx.sessionId)
      return { stepText, hadToolCalls: false, wroteAssistantFinal: true, shouldContinue: false, durationMs, toolNames, exitReason: 'no_tool_calls' }
    }
    log.info(`[ReactLoop]   → empty (no text, no tools) [${durationMs}ms]`)
    return { stepText: '', hadToolCalls: false, wroteAssistantFinal: false, shouldContinue: false, durationMs, toolNames, exitReason: 'empty_text' }
  }

  // 有工具调用 → 落库 assistant + tool，继续下一步
  const toolResults = await result.toolResults
  if (toolResults.length === 0) {
    log.error(`[ReactLoop]   → tools called but no results returned [${durationMs}ms]`)
    return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: false, durationMs, toolNames, exitReason: 'empty_tool_results' }
  }

  for (const tc of stepToolCalls) {
    log.info(`[ReactLoop]   → tool: ${tc.toolName} [${durationMs}ms]`)
  }
  log.info(`[ReactLoop]   → persist: assistant(${stepText ? 'text+' : ''}tool_use×${stepToolCalls.length}) + tool(result×${toolResults.length})`)

  const assistantBlocks: ContentBlock[] = []
  if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
  for (const tc of stepToolCalls) {
    assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
  }
  messageRepo.create({ id: uuidv4(), session_id: ctx.sessionId, role: 'assistant', content: assistantBlocks })

  const toolBlocks: ContentBlock[] = toolResultPartsToBlocks(toolResults)
  messageRepo.create({ id: uuidv4(), session_id: ctx.sessionId, role: 'tool', content: toolBlocks })

  return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: true, durationMs, toolNames }
}

// ── runFallbackSummary ──────────────────────────────────────────────────

/**
 * 兜底摘要。
 *
 * 触发条件（由 runReactLoop 判断）：主循环结束后 fullText 为 0 且未写过最终 assistant 消息。
 * 常见场景：模型连续调用工具但始终没有输出文本（如只调用了 read 但没生成总结）。
 *
 * 行为：不带 tools 做一次 streamText，把文本流式回调并落库。
 * 异常策略：catch 后仅记录，**不抛出**——避免破坏外层 orchestrator 的 onDone 语义。
 */
async function runFallbackSummary(ctx: StepContext): Promise<void> {
  log.info(`[ReactLoop] ${SEPARATOR} fallback summary ${SEPARATOR}`)
  const summaryStart = Date.now()
  try {
    const summaryCtx = {
      sessionId: ctx.sessionId,
      currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      workspacePath: ctx.workspace || undefined,
    }
    const { messages } = await ctx.pipeline.build(summaryCtx)
    const summaryResult = streamText({
      model: ctx.model,
      messages,
      abortSignal: buildStreamSignal(ctx.abortSignal),
    })
    let summaryText = ''
    for await (const chunk of summaryResult.textStream) {
      summaryText += chunk
      ctx.callbacks.onTextDelta(chunk)
    }
    const durationMs = Date.now() - summaryStart
    if (summaryText.trim()) {
      messageRepo.create({
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: summaryText }],
      })
      sessionRepo.touch(ctx.sessionId)
      log.info(`[ReactLoop]   → summary: ${summaryText.length} chars [${durationMs}ms]`)
    } else {
      log.info(`[ReactLoop]   → summary: empty [${durationMs}ms]`)
    }
  } catch (err) {
    log.error(`[ReactLoop]   → summary failed [${Date.now() - summaryStart}ms]:`, err)
  }
}

// ── runReactLoop（公开入口）────────────────────────────────────────────

/**
 * ReAct 循环顶层。
 *
 * 终止条件（任一触发即退出）：
 *   a. abortSignal.aborted —— 调用方主动中止（用户点"停止"或同 session 发了新消息）
 *   b. 达到 maxSteps —— 防止无限循环的硬上限（默认 1000）
 *   c. 某步无工具调用 —— 模型认为推理完成（正常终态）
 *   d. 某步有工具调用但 toolResults 为空 —— 异常保护，安全退出
 *
 * 兜底：循环结束后，若整轮 fullText 为空且未写过最终 assistant 消息，
 * 追加 runFallbackSummary 保证用户至少看到一段文本（不会静默无响应）。
 * 仅在非 abort 场景触发——用户主动停止时不做兜底。
 */
export async function runReactLoop(opts: ReactLoopOptions): Promise<void> {
  const loopStart = Date.now()
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS

  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
  log.info(`[ReactLoop] start | session: ${opts.sessionId} | maxSteps: ${maxSteps}`)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)

  const ctx: StepContext = {
    model: opts.model,
    tools: opts.tools,
    sessionId: opts.sessionId,
    messageId: opts.messageId,
    userContent: opts.userContent,
    mappedAttachments: opts.mappedAttachments,
    abortSignal: opts.abortSignal,
    pipeline: opts.pipeline,
    provider: opts.provider,
    providerConfig: opts.providerConfig,
    workspace: opts.workspace,
    callbacks: opts.callbacks,
  }

  let fullText = ''
  let wroteAssistantFinal = false
  let totalSteps = 0
  let totalToolCalls = 0
  let exitReason: LoopExitReason = 'no_tool_calls'
  const allToolNames: string[] = []

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }
    const outcome = await runReactStep(ctx, step, maxSteps)
    totalSteps++
    fullText += outcome.stepText
    totalToolCalls += outcome.toolNames.length
    allToolNames.push(...outcome.toolNames)
    if (outcome.wroteAssistantFinal) wroteAssistantFinal = true
    if (!outcome.shouldContinue) {
      exitReason = outcome.exitReason ?? 'no_tool_calls'
      break
    }
    if (step === maxSteps - 1) {
      exitReason = 'max_steps'
    }
  }

  // 兜底摘要：整轮一字没吐且非 abort → 强制一次无工具 streamText
  if (!wroteAssistantFinal && fullText.length === 0 && !opts.abortSignal.aborted) {
    exitReason = 'fallback_summary'
    await runFallbackSummary(ctx)
  }

  // 循环结束报告
  const totalMs = Date.now() - loopStart
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
  log.info(`[ReactLoop] done | steps: ${totalSteps} | total: ${(totalMs / 1000).toFixed(1)}s | exit: ${exitReason}`)
  log.info(`[ReactLoop]      | text: ${fullText.length} chars | tools: ${totalToolCalls} calls [${[...new Set(allToolNames)].join(', ') || 'none'}]`)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
}
