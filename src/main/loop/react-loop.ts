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
}

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
  const pipelineCtx = {
    sessionId: ctx.sessionId,
    currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    workspacePath: ctx.workspace || undefined,
  }
  const { messages } = await ctx.pipeline.build(pipelineCtx)
  log.info(`[ReactLoop] step ${stepIndex + 1}/${maxSteps}, messages: ${messages.length}`)

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
      log.error('[ReactLoop] Stream error:', error)
    },
  })

  try {
    await result.consumeStream()
  } catch (streamErr) {
    log.error(`[ReactLoop] consumeStream failed at step ${stepIndex + 1}:`, streamErr)
    throw streamErr
  }
  log.info(`[ReactLoop] consumed, toolCalls: ${stepToolCalls.length}, stepText: ${stepText.length}`)

  // 无工具调用 → 本次推理结束（正常终态）
  if (stepToolCalls.length === 0) {
    if (stepText) {
      messageRepo.create({
        id: ctx.messageId,
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: stepText }],
      })
      sessionRepo.touch(ctx.sessionId)
      return { stepText, hadToolCalls: false, wroteAssistantFinal: true, shouldContinue: false }
    }
    return { stepText: '', hadToolCalls: false, wroteAssistantFinal: false, shouldContinue: false }
  }

  // 有工具调用 → 落库 assistant + tool，继续下一步
  const toolResults = await result.toolResults
  if (toolResults.length === 0) {
    // SDK 返回了 tool-call chunk 但没有对应的 toolResults——通常是 bug 或中止竞态。
    // 安全退出，避免无限循环。
    log.error('[ReactLoop] Tool calls made but no results returned, breaking')
    return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: false }
  }

  const assistantBlocks: ContentBlock[] = []
  if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
  for (const tc of stepToolCalls) {
    assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
  }
  messageRepo.create({ id: uuidv4(), session_id: ctx.sessionId, role: 'assistant', content: assistantBlocks })

  const toolBlocks: ContentBlock[] = toolResultPartsToBlocks(toolResults)
  messageRepo.create({ id: uuidv4(), session_id: ctx.sessionId, role: 'tool', content: toolBlocks })
  log.info(`[ReactLoop] Persisted assistant + tool messages for step ${stepIndex + 1}`)

  return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: true }
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
  log.info('[ReactLoop] No final text, requesting forced summary')
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
    if (summaryText.trim()) {
      messageRepo.create({
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: summaryText }],
      })
      sessionRepo.touch(ctx.sessionId)
      log.info('[ReactLoop] Forced summary written, length:', summaryText.length)
    }
  } catch (err) {
    log.error('[ReactLoop] Forced summary failed:', err)
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
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
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

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) break
    const outcome = await runReactStep(ctx, step, maxSteps)
    fullText += outcome.stepText
    if (outcome.wroteAssistantFinal) wroteAssistantFinal = true
    if (!outcome.shouldContinue) break
  }

  // 兜底摘要：整轮一字没吐且非 abort → 强制一次无工具 streamText
  if (!wroteAssistantFinal && fullText.length === 0 && !opts.abortSignal.aborted) {
    await runFallbackSummary(ctx)
  }
}
