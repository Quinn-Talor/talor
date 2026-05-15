// src/main/loop/react-loop.ts —— 业务层: ReAct 多步推理引擎
//
// 控制流:
//   外层 for (step < maxSteps) 每步独立调一次 streamText (stepCountIs(1))。
//   每步:
//     1. composeHint(detectors) ?? nextPolicyHint
//     2. runReactStep — pipeline.build → streamText → persistStepFromResult
//     3. accumulator.observe + mcpState.update
//     4. detector chain — 任一 triggered 即 forced summary + break
//     5. 无 tool: turn-end policy chain 决定 final / continue
//
// 关键设计: pipeline.build 每步重建 — skill / MCP search_tool / memory 压缩
// 立即生效, 不积压到下次循环。
//
// 允许依赖: loop/*, repos/*, shared/*
// 禁止依赖: ipc/*

import { streamText, stepCountIs, type LanguageModel, type StepResult, type ToolSet } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { buildStreamSignal } from './stream-utils'
import { buildTools } from '../tools/build-tools'
import { estimate } from '../memory/types'
import type { ReactLoopOptions, ReactLoopCallbacks, LoopExitReason } from './types'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { LoopAccumulator } from './loop-accumulator'
import { McpExposureState } from './mcp-exposure-state'
import { runForcedSummary, FALLBACK_SUMMARY_OPTS } from './forced-summary'
import { composeHint } from './compose-hint'
import { SignatureDeadLoopDetector } from './detectors/signature-dead-loop'
import { FailureStreakDetector } from './detectors/failure-streak'
import { ToolOnlyLoopDetector } from './detectors/tool-only-loop'
import { LengthTruncationStreakDetector } from './detectors/length-truncation-streak'
import {
  buildDefaultChain,
  runPolicyChain,
  type TurnEndPolicy,
  type PolicyContext,
} from './turn-end-policies'
import { factsFromStep, outcomeFromStep, extractTextFromStep } from './step-adapter'
import { persistStepFromResult, persistAbortedStep } from './persist-step'

/** 单步 prompt 估算到达该比例时,提醒模型收敛。 */
const CONTEXT_USAGE_WARNING_RATIO = 0.98
const DEFAULT_MAX_STEPS = 1000

/**
 * 主对话 streamText 的 maxOutputTokens 默认值。
 *
 * 64_000 = 现代 provider 安全交集 (Anthropic / Gemini 上限);
 * DeepSeek / OpenAI 支持更高但不浪费。
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000

const SEPARATOR = '──────────────────────────────────────────'
const DOUBLE_SEPARATOR = '══════════════════════════════════════════'

// ── 内部类型 ────────────────────────────────────────────────────────────

interface LoopCtx {
  model: LanguageModel
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
  agent: import('../agent/agent').Agent
  confirmTool: ToolConfirmPort
  requestPermission?: import('../tools/types').PermissionPort
  agentId: string
  skillTracker: import('../skills/registry').SkillActivationTracker
  events: import('../chat/events').ExecutionEventBus
  streamOptions?: Record<string, unknown>
  turnStartTime: string
  turnEndPolicies: readonly TurnEndPolicy[]
}

/** runReactStep 返回的单步结果 (供主循环消费)。 */
interface StepRunResult {
  /** SDK StepResult — null 表示 context_overflow 短路 (未调 streamText) */
  step: StepResult<ToolSet> | null
  durationMs: number
  exitReason?: 'context_overflow' | 'abort'
  /** SDK 信号 (turn-end policy / 日志用) */
  sdkSignals?: PolicyContext['sdkSignals']
  /** 上步输入 tokens (用于下步 context 预算精算) */
  lastInputTokens?: number
}

// ── runReactLoop ────────────────────────────────────────────────────────

/**
 * ReAct 循环顶层。
 *
 * 终止条件:
 *   a. abortSignal.aborted
 *   b. maxSteps 上限
 *   c. detector triggered (signature-dead-loop / failure-streak / length-truncation)
 *   d. turn-end policy 判 final (无 tool + 有 text)
 *   e. empty_text (无 tool + 无 text)
 *   f. context_overflow (prompt 估算 ≥ 100% halt)
 *
 * 兜底: 循环结束后, 若 accumulator.needsFallback() 且非 abort/context_overflow,
 * 调一次 runForcedSummary 让用户至少看到一段文本。
 */
export async function runReactLoop(opts: ReactLoopOptions): Promise<void> {
  const loopStart = Date.now()
  const turnStartTime = new Date(loopStart).toISOString()
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS

  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
  log.info(`[ReactLoop] start | session: ${opts.sessionId} | maxSteps: ${maxSteps}`)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)

  const turnEndPolicies = buildDefaultChain()
  const ctx: LoopCtx = {
    model: opts.model,
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
    agent: opts.agent,
    confirmTool: opts.confirmTool,
    requestPermission: opts.requestPermission,
    agentId: opts.agent.id,
    skillTracker: opts.skillTracker,
    events: opts.events,
    streamOptions: opts.streamOptions,
    turnStartTime,
    turnEndPolicies,
  }

  const accumulator = new LoopAccumulator()
  const mcpState = new McpExposureState(opts.agent)

  // Detector 顺序敏感 (业务属性, 显式排列):
  //   1. signature-dead-loop:    原地重试同一调用 (硬切断 + forced summary)
  //   2. failure-streak:         连续 N 次工具失败 (硬切断 + forced summary)
  //   3. tool-only-loop:         零文本工具链 (仅注入 nextHint, 从不 triggered)
  //   4. length-truncation:      连续 finishReason='length' 截断 (硬切断)
  const detectors: import('./detectors/types').LoopDetector[] = [
    new SignatureDeadLoopDetector(ctx),
    new FailureStreakDetector(ctx),
    new ToolOnlyLoopDetector(),
    new LengthTruncationStreakDetector(),
  ]

  let exitReason: LoopExitReason = 'no_tool_calls'
  let nextPolicyHint: string | null = null
  let lastInputTokens: number | undefined

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }

    // 优先级: detector hint > turn-end policy hint
    // (composeHint 当 detector 有非空 hint 时返非 null; 否则 fallback 到 policy hint)
    const hint = composeHint(detectors) ?? nextPolicyHint
    nextPolicyHint = null

    const { expand: mcpExpand, used: mcpUsed } = mcpState.flags

    let stepResult: StepRunResult
    try {
      stepResult = await runReactStep(ctx, step, maxSteps, {
        hint,
        mcpExpand,
        mcpUsed,
        lastInputTokens,
      })
    } catch (err) {
      // streamText 异常 / abort / provider crash — 主循环退出, 标记 abort
      log.error(`[ReactLoop] step ${step} threw:`, err)
      exitReason = opts.abortSignal.aborted ? 'abort' : 'fallback_summary'
      break
    }

    if (stepResult.exitReason === 'context_overflow') {
      exitReason = 'context_overflow'
      break
    }
    if (stepResult.exitReason === 'abort') {
      exitReason = 'abort'
      break
    }

    if (!stepResult.step) {
      // 不应发生:non-overflow non-abort 必有 step
      log.warn(`[ReactLoop] step ${step} returned null step without exit reason`)
      break
    }

    if (stepResult.lastInputTokens) lastInputTokens = stepResult.lastInputTokens

    const outcome = outcomeFromStep(stepResult.step, stepResult.durationMs)
    accumulator.observe(outcome)
    mcpState.update(outcome)

    // Detector chain — 顺序遍历, 第一个 triggered 即处理后 break
    const facts = factsFromStep(stepResult.step)
    const rawCtx = {
      stepText: outcome.stepText,
      finishReason: outcome.finishReason,
    }
    let detectorBroke = false
    for (const detector of detectors) {
      const verdict = detector.observe(facts, step, rawCtx)
      if (!verdict.triggered) continue
      log.warn(`[ReactLoop] Detector "${detector.name}" triggered (exit=${verdict.exitReason})`)
      if (verdict.runSummary) {
        try {
          await verdict.runSummary()
        } catch (e) {
          log.error(`[ReactLoop] detector "${detector.name}" runSummary failed:`, e)
        }
      }
      if (verdict.markFinal) accumulator.markFinal()
      exitReason = verdict.exitReason ?? 'repeated_error'
      detectorBroke = true
      break
    }
    if (detectorBroke) break

    // 无 tool 调用: turn-end policy 决定 final / continue
    if (outcome.toolNames.length === 0) {
      if (!outcome.stepText) {
        log.info(`[ReactLoop]   → empty (no text, no tools)`)
        exitReason = 'empty_text'
        break
      }
      const policyCtx: PolicyContext = {
        agent: opts.agent,
        sessionId: opts.sessionId,
        stepIndex: step,
        abortSignal: opts.abortSignal,
        sdkSignals: stepResult.sdkSignals ?? {
          finishReason: outcome.finishReason ?? 'stop',
        },
      }
      const decision = await runPolicyChain(turnEndPolicies, outcome, policyCtx)
      if (decision.action === 'final') {
        log.info(`[ReactLoop]   → FINAL by policy reason=${decision.exitReason ?? 'no_tool_calls'}`)
        exitReason = decision.exitReason ?? 'no_tool_calls'
        break
      }
      if (decision.action === 'continue') {
        log.info(`[ReactLoop]   → CONTINUE by policy`)
        nextPolicyHint = decision.injectHint ?? null
      } else {
        // 'no-opinion' — 防御性 fallthrough (LegacyNaturalFinalPolicy 兜底应避免)
        log.warn(`[ReactLoop]   policy chain no-opinion; treating as FINAL`)
        exitReason = 'no_tool_calls'
        break
      }
    }

    if (step === maxSteps - 1) exitReason = 'max_steps'
  }

  // 兜底摘要 (整轮零文本) — 仅非 abort / context_overflow 触发
  if (accumulator.needsFallback() && exitReason !== 'abort' && exitReason !== 'context_overflow') {
    exitReason = 'fallback_summary'
    await runForcedSummary(ctx, accumulator.totalSteps, FALLBACK_SUMMARY_OPTS)
  }

  // 循环结束报告
  const totalMs = Date.now() - loopStart
  const { summary, detail } = accumulator.buildReport(totalMs, exitReason)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
  log.info(`[ReactLoop] ${summary}`)
  log.info(`[ReactLoop]      | ${detail}`)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
}

// ── runReactStep — 单步 = 一次 streamText 调用 ──────────────────────────

async function runReactStep(
  ctx: LoopCtx,
  stepIndex: number,
  maxSteps: number,
  state: {
    hint: string | null
    mcpExpand: boolean
    mcpUsed: string[]
    lastInputTokens?: number
  },
): Promise<StepRunResult> {
  const stepStart = Date.now()

  // 1. Pipeline.build per-step (动态重建 — skill / MCP / memory / context)
  const pipelineCtx = {
    sessionId: ctx.sessionId,
    currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    workspacePath: ctx.workspace || undefined,
    agent: ctx.agent,
    skillTracker: ctx.skillTracker,
    events: ctx.events,
    mcpExpandThisStep: state.mcpExpand,
    usedMcpToolNames: state.mcpUsed,
  }
  const { messages, tools: toolSchemas } = await ctx.pipeline.build(pipelineCtx)

  // 2. Context budget guard (>= 100% halt; > 98% inject [CONTEXT NEARLY FULL])
  const limit = ctx.providerConfig.context_limit
  if (limit > 0) {
    let estimatedTokens = 0
    let usingPreciseUsage = false
    if (state.lastInputTokens && state.lastInputTokens > 0) {
      estimatedTokens = state.lastInputTokens
      usingPreciseUsage = true
    } else {
      for (const m of messages) {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        estimatedTokens += estimate(text)
      }
    }
    const usageRatio = estimatedTokens / limit

    if (usageRatio >= 1.0) {
      log.error(
        `[ReactLoop]   context overflow: ${estimatedTokens}/${limit} ` +
          `(${(usageRatio * 100).toFixed(1)}%, source=${usingPreciseUsage ? 'SDK' : 'estimate'}). Halting.`,
      )
      const haltText =
        `[auto-halt] Context window exceeded (${estimatedTokens}/${limit} tokens, ${(usageRatio * 100).toFixed(0)}%). ` +
        `Task stopped to avoid silent provider-side truncation. Please start a new session or trim the conversation history.`
      messageRepo.create({
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: haltText }],
        agent_id: ctx.agentId,
      })
      sessionRepo.touch(ctx.sessionId)
      ctx.callbacks.onMessagePersisted?.(ctx.sessionId, stepIndex)
      ctx.callbacks.onTextDelta(haltText, stepIndex)
      return { step: null, durationMs: Date.now() - stepStart, exitReason: 'context_overflow' }
    }

    if (usageRatio > CONTEXT_USAGE_WARNING_RATIO) {
      log.warn(
        `[ReactLoop]   context near overflow: ${estimatedTokens}/${limit} (${(usageRatio * 100).toFixed(1)}%)`,
      )
      messages.push({
        role: 'system',
        content:
          `[CONTEXT NEARLY FULL] Prompt is using ~${(usageRatio * 100).toFixed(0)}% of the available window. ` +
          `Prefer concise responses and avoid large tool outputs. Finish any in-progress task first, then summarize.`,
      })
    }
  }

  // 3. Hint 注入 (detector hint 或 turn-end policy hint)
  if (state.hint) {
    messages.push({ role: 'system', content: state.hint })
    log.info(`[ReactLoop]   injected hint (${state.hint.length} chars)`)
  }

  // 4. buildTools per-step
  const tools = await buildTools({
    sessionId: ctx.sessionId,
    messageId: ctx.messageId,
    workspace: ctx.workspace,
    confirmTool: ctx.confirmTool,
    requestPermission: ctx.requestPermission,
    agent: ctx.agent,
    toolSchemas,
    skillTracker: ctx.skillTracker,
    abortSignal: ctx.abortSignal,
    getCurrentStepBlocks: () => [],
    stepIndex,
    parentSessionIdForLedger: null,
  })

  // 5. streamText 参数 — 优先级: agent prefs > provider config > 默认值
  const provider = ctx.provider
  const agentPrefs = ctx.agent?.profile?.preferences ?? undefined
  const streamParams: Record<string, unknown> = {
    maxOutputTokens:
      agentPrefs?.maxOutputTokens ?? provider.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxRetries: provider.max_retries,
    headers: provider.headers,
  }
  if (agentPrefs?.temperature !== undefined) streamParams.temperature = agentPrefs.temperature
  if (agentPrefs?.topP !== undefined) streamParams.topP = agentPrefs.topP
  if (agentPrefs?.seed !== undefined) streamParams.seed = agentPrefs.seed
  if (agentPrefs?.toolChoice !== undefined) streamParams.toolChoice = agentPrefs.toolChoice
  if (provider.request_timeout_ms !== undefined) streamParams.timeout = provider.request_timeout_ms
  const adapterProviderOpts =
    (ctx.streamOptions as { providerOptions?: Record<string, unknown> } | undefined)
      ?.providerOptions ?? {}
  streamParams.providerOptions = { ...adapterProviderOpts, ...(provider.provider_options ?? {}) }

  log.info(`[ReactLoop] ${SEPARATOR} step ${stepIndex + 1}/${maxSteps} ${SEPARATOR}`)
  log.info(`[ReactLoop]   messages: ${messages.length} | provider: ${ctx.provider.name}`)

  // 6. streamText (single step — stepCountIs(1) 显式)
  const result = streamText({
    model: ctx.model,
    messages,
    tools,
    ...ctx.streamOptions,
    ...streamParams,
    abortSignal: buildStreamSignal(ctx.abortSignal),
    stopWhen: stepCountIs(1),

    onChunk({ chunk }) {
      if (chunk.type === 'text-delta' && chunk.text.length > 0) {
        ctx.callbacks.onTextDelta(chunk.text, stepIndex)
      }
    },

    experimental_onToolCallStart({ toolCall }) {
      const startedAt = Date.now()
      log.info(
        `[ReactLoop]   ⊳ tool-start: ${toolCall.toolName} id=${toolCall.toolCallId.slice(0, 12)}`,
      )
      ctx.callbacks.onToolCall(
        toolCall.toolCallId,
        toolCall.toolName,
        toolCall.input,
        stepIndex,
        startedAt,
      )
    },

    experimental_onToolCallFinish(event) {
      log.info(
        `[ReactLoop]   ⊲ tool-finish: ${event.toolCall.toolName} id=${event.toolCall.toolCallId.slice(0, 12)} [${event.durationMs}ms] success=${event.success}`,
      )
      const output = event.success
        ? event.output
        : {
            __talor_error: true,
            code: 'SDK_TOOL_ERROR',
            message:
              event.error instanceof Error
                ? event.error.message
                : typeof event.error === 'string'
                  ? event.error
                  : JSON.stringify(event.error),
          }
      ctx.callbacks.onToolResult(
        event.toolCall.toolCallId,
        event.toolCall.toolName,
        output,
        event.durationMs,
      )
    },

    onError({ error }) {
      log.error('[ReactLoop]   stream error:', error)
    },
  })

  let persisted = false
  let stepResult: StepRunResult
  try {
    await result.consumeStream()

    // 7. 拉单步 StepResult + SDK 信号
    //    Cast 必要: result.steps 推断的 TOOLS 是 tools 入参的精确类型, 与
    //    persist-step / step-adapter 的 StepResult<ToolSet> 不直接兼容。
    //    运行时字段相同, 安全。
    const steps = (await result.steps) as unknown as StepResult<ToolSet>[]
    const step = steps[0]
    if (!step) {
      log.warn('[ReactLoop]   streamText returned 0 steps')
      return { step: null, durationMs: Date.now() - stepStart, exitReason: 'abort' }
    }

    const safeAwait = <T>(v: unknown): Promise<T | undefined> =>
      Promise.resolve(v as Promise<T> | T | undefined).catch(() => undefined as T | undefined)
    const [finishReason, usage, providerMetadata, warnings] = await Promise.all([
      safeAwait<import('ai').FinishReason>(result.finishReason).then((r) => r ?? 'stop'),
      safeAwait<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>(
        result.usage,
      ),
      safeAwait<Record<string, unknown>>(result.providerMetadata),
      safeAwait<import('ai').CallWarning[]>(result.warnings),
    ])

    const durationMs = Date.now() - stepStart

    // 8. 持久化 (persistStepFromResult: tool-pair createBatch 或 text-only create)
    try {
      await persistStepFromResult(step, {
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        finalMessageId: ctx.messageId,
        isMidTurnText: true, // FINAL 决策由主循环 turn-end policy 做; 此处统一 mid-turn
      })
      persisted = true
      ctx.callbacks.onMessagePersisted?.(ctx.sessionId, stepIndex)
    } catch (err) {
      log.error('[ReactLoop]   persist failed:', err)
    }

    // 9. Provider warnings 日志
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        const wType =
          typeof w === 'object' && w !== null && 'type' in w
            ? String((w as { type?: unknown }).type)
            : '?'
        const wMsg =
          typeof w === 'object' && w !== null && 'message' in w
            ? String((w as { message?: unknown }).message)
            : JSON.stringify(w)
        log.warn(`[ReactLoop]   provider warning [${wType}]: ${wMsg}`)
      }
    }

    // 10. Anthropic cache 命中观测
    const anthroMeta = providerMetadata?.anthropic as
      | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
      | undefined
    if (anthroMeta && (anthroMeta.cacheReadInputTokens || anthroMeta.cacheCreationInputTokens)) {
      log.info(
        `[ReactLoop]   cache: read=${anthroMeta.cacheReadInputTokens ?? 0}t create=${anthroMeta.cacheCreationInputTokens ?? 0}t`,
      )
    }

    stepResult = {
      step,
      durationMs,
      sdkSignals: { finishReason, usage, providerMetadata, warnings },
      lastInputTokens: usage?.inputTokens,
    }
    return stepResult
  } catch (err) {
    // streamText / consumeStream 异常 — 兜底落 aborted, 上抛给主循环
    log.error('[ReactLoop]   consumeStream failed:', err)
    if (!persisted) {
      let partialSteps: StepResult<ToolSet>[] = []
      try {
        partialSteps = (await result.steps) as unknown as StepResult<ToolSet>[]
      } catch {
        // ignore — partialSteps stays empty
      }
      const partialText = extractTextFromStep(partialSteps[0] ?? ({} as StepResult<ToolSet>))
      await persistAbortedStep({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        stepText: partialText,
        toolCallNames: [],
      })
      ctx.callbacks.onMessagePersisted?.(ctx.sessionId, stepIndex)
    }
    throw err
  }
}
