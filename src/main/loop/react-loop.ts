// src/main/loop/react-loop.ts —— 业务层：ReAct 多步推理引擎 (v4 SDK-native)
//
// v4 改造 (2026-05-14):
//   - SDK 内置多步 (streamText + stopWhen + prepareStep + onStepFinish + experimental_repairToolCall)
//   - 外层 while 仅处理 turn-end policy 续做 (SDK 不能在"无 tool 但续做"时自动循环)
//   - 持久化迁到 onStepFinish (persistStepFromResult, 全部用 uuid)
//   - Detector observe + accumulator update 也在 onStepFinish 内
//   - Hint 注入移到 prepareStep
//   - Step 数累计在 detectorState (跨 streamText 调用共享)
//
// 检测器分布:
//   src/main/loop/detectors/
//     signature-dead-loop / failure-streak / tool-only-loop (软提示) /
//     length-truncation-streak
//
// 允许依赖：loop/*、repos/*、shared/*
// 禁止依赖：ipc/*

import { streamText, type LanguageModel, type StepResult, type ToolSet } from 'ai'
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
import { createDetectorState, type DetectorState } from './detector-state'
import { factsFromStep, outcomeFromStep, extractTextFromStep } from './step-adapter'
import { persistStepFromResult, persistAbortedStep } from './persist-step'

/** 单步 prompt 估算到达该比例时,提醒模型收敛 (v3 沿用)。 */
const CONTEXT_USAGE_WARNING_RATIO = 0.98
const DEFAULT_MAX_STEPS = 1000

/**
 * v3.7.3: 主对话 streamText 的 maxOutputTokens 默认值。
 *
 * 64_000 = "现代 provider 安全交集" (Anthropic 4 / Gemini 2.5 上限);
 * DeepSeek V4 / OpenAI gpt-4o 支持更高但不浪费。
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

// ── runReactLoop ────────────────────────────────────────────────────────

/**
 * ReAct 循环顶层 (v4)。
 *
 * 流程:
 *   外层 while 每次迭代 = 一个 "turn segment" = 一次 streamText 调用 (SDK 内部多步)。
 *   streamText 自然停止 (无 tool 调用) 或 stopWhen 命中 (detector / stepCountIs) 即退出。
 *   退出后:
 *     - detector 触发 → 跑 pendingForcedSummary, break
 *     - 无 tool + 有 text → 跑 turn-end policy → final / continue
 *     - 无 tool + 无 text → empty_text break
 *
 * 终止条件:
 *   a. abortSignal.aborted
 *   b. detectorState.totalSteps >= maxSteps
 *   c. detector triggered (signature-dead-loop / failure-streak / length-truncation)
 *   d. turn-end policy 判 final
 *   e. empty_text (无 tool + 无 text)
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

  const detectorState = createDetectorState()
  const accumulator = new LoopAccumulator()
  const mcpState = new McpExposureState(opts.agent)

  // Detector 顺序敏感:
  //   1. signature-dead-loop:    原地重试同一调用 (硬切断)
  //   2. failure-streak:         连续 N 次工具失败 (硬切断 + forced summary)
  //   3. tool-only-loop:         零文本工具链 (v4.1 软提示, 不再 break)
  //   4. length-truncation:      连续 finishReason='length' (硬切断)
  const detectors: import('./detectors/types').LoopDetector[] = [
    new SignatureDeadLoopDetector(ctx),
    new FailureStreakDetector(ctx),
    new ToolOnlyLoopDetector(),
    new LengthTruncationStreakDetector(),
  ]

  let exitReason: LoopExitReason = 'no_tool_calls'
  let nextPolicyHint: string | null = null
  let turnDone = false

  while (!turnDone) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }
    if (detectorState.totalSteps >= maxSteps) {
      exitReason = 'max_steps'
      break
    }

    // 每个 segment 重置 segment-级状态
    detectorState.shouldStop = false
    detectorState.pendingForcedSummary = null
    detectorState.markFinal = false

    const segmentResult = await runStreamSegment(
      ctx,
      detectorState,
      detectors,
      accumulator,
      mcpState,
      nextPolicyHint,
    )
    nextPolicyHint = null

    if (segmentResult.kind === 'abort') {
      exitReason = 'abort'
      break
    }
    if (segmentResult.kind === 'context-overflow') {
      exitReason = 'context_overflow'
      break
    }

    // Detector 触发 → 跑 forced summary 后 break
    if (detectorState.shouldStop) {
      const pending = detectorState.pendingForcedSummary as (() => Promise<void>) | null
      if (pending) {
        try {
          await pending()
        } catch (err) {
          log.error('[ReactLoop] pendingForcedSummary failed:', err)
        }
      }
      if (detectorState.markFinal) accumulator.markFinal()
      exitReason = detectorState.exitReason ?? 'repeated_error'
      break
    }

    // 自然结束 → 看最后一 step 决定 final / continue
    const lastStep = segmentResult.lastStep
    if (!lastStep) {
      log.warn('[ReactLoop] streamText finished with 0 steps')
      break
    }
    const outcome = outcomeFromStep(lastStep, 0)

    if (outcome.toolNames.length > 0) {
      // 有 tool — stepCountIs 触发 (segment 步预算到了); 等价 max_steps
      exitReason = 'max_steps'
      break
    }
    if (!outcome.stepText) {
      // 无 tool 无 text — empty
      log.info(`[ReactLoop]   → empty (no text, no tools)`)
      exitReason = 'empty_text'
      break
    }

    // 无 tool + 有 text — 跑 turn-end policy 链
    const policyCtx: PolicyContext = {
      agent: opts.agent,
      sessionId: opts.sessionId,
      stepIndex: detectorState.totalSteps,
      abortSignal: opts.abortSignal,
      sdkSignals: {
        finishReason: lastStep.finishReason,
        usage: lastStep.usage as {
          inputTokens?: number
          outputTokens?: number
          totalTokens?: number
        },
        providerMetadata: lastStep.providerMetadata,
        warnings: lastStep.warnings,
      },
    }
    const decision = await runPolicyChain(turnEndPolicies, outcome, policyCtx)

    if (decision.action === 'final') {
      log.info(`[ReactLoop]   → FINAL by policy reason=${decision.exitReason ?? 'no_tool_calls'}`)
      turnDone = true
      exitReason = decision.exitReason ?? 'no_tool_calls'
    } else if (decision.action === 'continue') {
      log.info(`[ReactLoop]   → CONTINUE by policy`)
      nextPolicyHint = decision.injectHint ?? null
      // 继续下一个 segment
    } else {
      // 'no-opinion' — 不应发生 (LegacyNaturalFinalPolicy 兜底); 防御性 fallthrough
      log.warn(`[ReactLoop]   policy chain returned no-opinion; treating as FINAL`)
      turnDone = true
      exitReason = 'no_tool_calls'
    }
  }

  // 兜底摘要 (整轮零文本) — 仅非 abort / context_overflow 触发
  // (context_overflow 已经写了 [auto-halt] 给用户,不再 fallback)
  if (accumulator.needsFallback() && exitReason !== 'abort' && exitReason !== 'context_overflow') {
    exitReason = 'fallback_summary'
    await runForcedSummary(ctx, detectorState.totalSteps, FALLBACK_SUMMARY_OPTS)
  }

  // 循环结束报告
  const totalMs = Date.now() - loopStart
  const { summary, detail } = accumulator.buildReport(totalMs, exitReason)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
  log.info(`[ReactLoop] ${summary}`)
  log.info(`[ReactLoop]      | ${detail}`)
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
}

// ── runStreamSegment — 一个 turn segment (一次 streamText SDK 多步) ──────

type SegmentResult =
  | { kind: 'natural'; lastStep: StepResult<ToolSet> | null }
  | { kind: 'detector-triggered'; lastStep: StepResult<ToolSet> | null }
  | { kind: 'abort' }
  | { kind: 'context-overflow' }

async function runStreamSegment(
  ctx: LoopCtx,
  detectorState: DetectorState,
  detectors: readonly import('./detectors/types').LoopDetector[],
  accumulator: LoopAccumulator,
  mcpState: McpExposureState,
  initialPolicyHint: string | null,
): Promise<SegmentResult> {
  const segmentStart = Date.now()

  // Pipeline 一次构造 — segment 内所有 step 复用同一组 messages + tools
  // (per-step messages 由 SDK 内部累计上一步的 assistant + tool_result)
  const { expand: mcpExpand, used: mcpUsed } = mcpState.flags
  const pipelineCtx = {
    sessionId: ctx.sessionId,
    currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    workspacePath: ctx.workspace || undefined,
    agent: ctx.agent,
    skillTracker: ctx.skillTracker,
    events: ctx.events,
    mcpExpandThisStep: mcpExpand,
    usedMcpToolNames: mcpUsed,
  }
  const { messages, tools: toolSchemas } = await ctx.pipeline.build(pipelineCtx)

  // Context budget guard (v3 沿用):
  //   >=100% 硬阻断;>98% 软告警注入 [CONTEXT NEARLY FULL]
  const limit = ctx.providerConfig.context_limit
  if (limit > 0) {
    let estimatedTokens = 0
    let usingPreciseUsage = false
    if (detectorState.lastInputTokens && detectorState.lastInputTokens > 0) {
      estimatedTokens = detectorState.lastInputTokens
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
      ctx.callbacks.onMessagePersisted?.(ctx.sessionId, detectorState.totalSteps)
      ctx.callbacks.onTextDelta(haltText, detectorState.totalSteps)
      return { kind: 'context-overflow' }
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
    // v4: getCurrentStepBlocks 仍提供 — RiskGate path 2 已删,但 ledger / 其他 ctx 可能用
    getCurrentStepBlocks: () => [],
    stepIndex: detectorState.totalSteps,
    parentSessionIdForLedger: null,
  })

  // v4 Phase 1: per-provider / per-agent 参数 (优先级 agent > provider > 默认)
  const provider = ctx.provider
  const agentPrefs = ctx.agent?.profile?.preferences ?? undefined
  const v4Params: Record<string, unknown> = {
    maxOutputTokens:
      agentPrefs?.maxOutputTokens ?? provider.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxRetries: provider.max_retries,
    headers: provider.headers,
  }
  if (agentPrefs?.temperature !== undefined) v4Params.temperature = agentPrefs.temperature
  if (agentPrefs?.topP !== undefined) v4Params.topP = agentPrefs.topP
  if (agentPrefs?.seed !== undefined) v4Params.seed = agentPrefs.seed
  if (agentPrefs?.toolChoice !== undefined) v4Params.toolChoice = agentPrefs.toolChoice
  if (provider.request_timeout_ms !== undefined) v4Params.timeout = provider.request_timeout_ms
  const adapterProviderOpts =
    (ctx.streamOptions as { providerOptions?: Record<string, unknown> } | undefined)
      ?.providerOptions ?? {}
  v4Params.providerOptions = { ...adapterProviderOpts, ...(provider.provider_options ?? {}) }

  log.info(
    `[ReactLoop] ${SEPARATOR} segment start (totalSteps=${detectorState.totalSteps}) ${SEPARATOR}`,
  )
  log.info(`[ReactLoop]   messages: ${messages.length} | provider: ${ctx.provider.name}`)

  // segment 内最后完成的 step (供 turn-end policy 用)
  let lastStep: StepResult<ToolSet> | null = null
  // 单次注入: composeHint(detectors) 优先于 initialPolicyHint, 取走即清
  let policyHintForNextStep: string | null = initialPolicyHint

  // segment 已完成 step 数 (本次 streamText 内)
  let segmentStepCount = 0
  const stepsBudget = (ctx as { _maxSteps?: number })._maxSteps ?? DEFAULT_MAX_STEPS
  void stepsBudget // referenced inline below

  try {
    const result = streamText({
      model: ctx.model,
      messages,
      tools,
      ...ctx.streamOptions,
      ...v4Params,
      abortSignal: buildStreamSignal(ctx.abortSignal),

      stopWhen: [
        // 全局步数预算 (跨 segment 累计)
        ({ steps }) => detectorState.totalSteps + steps.length >= DEFAULT_MAX_STEPS,
        // detector 触发
        () => detectorState.shouldStop,
      ],

      prepareStep: async ({ messages: stepMessages }) => {
        const hint = composeHint(detectors) ?? policyHintForNextStep
        policyHintForNextStep = null
        if (!hint) return undefined
        log.info(`[ReactLoop]   injected hint (${hint.length} chars)`)
        return { messages: [...stepMessages, { role: 'system', content: hint }] }
      },

      onStepFinish: async (event) => {
        lastStep = event as unknown as StepResult<ToolSet>
        segmentStepCount++

        // 1. 持久化 (无 tool + 有 text / 有 tool 都走 persistStepFromResult)
        try {
          await persistStepFromResult(lastStep, {
            sessionId: ctx.sessionId,
            agentId: ctx.agentId,
            finalMessageId: ctx.messageId,
            isMidTurnText: true, // v4: 所有中间 text 都 mid-turn; outer loop FINAL 时不再二次落库
          })
          ctx.callbacks.onMessagePersisted?.(ctx.sessionId, detectorState.totalSteps)
        } catch (err) {
          log.error('[ReactLoop]   persist failed (non-fatal):', err)
        }

        // 2. Detector observe + accumulator update
        const facts = factsFromStep(lastStep)
        const outcome = outcomeFromStep(lastStep, 0)
        accumulator.observe(outcome)
        mcpState.update(outcome)
        const rawCtx = {
          stepText: extractTextFromStep(lastStep),
          finishReason: lastStep.finishReason,
        }
        for (const detector of detectors) {
          const verdict = detector.observe(facts, detectorState.totalSteps, rawCtx)
          if (verdict.triggered) {
            log.warn(
              `[ReactLoop] Detector "${detector.name}" triggered (exit=${verdict.exitReason})`,
            )
            detectorState.shouldStop = true
            detectorState.exitReason = verdict.exitReason ?? 'repeated_error'
            detectorState.pendingForcedSummary = verdict.runSummary ?? null
            detectorState.markFinal = !!verdict.markFinal
            break
          }
        }

        // 3. SDK usage → lastInputTokens (J-SHOULD-3 类别 B)
        if (lastStep.usage?.inputTokens && lastStep.usage.inputTokens > 0) {
          detectorState.lastInputTokens = lastStep.usage.inputTokens
        }

        // 4. Provider warnings 日志
        if (lastStep.warnings && lastStep.warnings.length > 0) {
          for (const w of lastStep.warnings) {
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

        // 5. Anthropic cache 命中观测
        const anthroMeta = lastStep.providerMetadata?.anthropic as
          | { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
          | undefined
        if (
          anthroMeta &&
          (anthroMeta.cacheReadInputTokens || anthroMeta.cacheCreationInputTokens)
        ) {
          log.info(
            `[ReactLoop]   cache: read=${anthroMeta.cacheReadInputTokens ?? 0}t create=${anthroMeta.cacheCreationInputTokens ?? 0}t`,
          )
        }

        detectorState.totalSteps++
      },

      onChunk({ chunk }) {
        if (chunk.type === 'text-delta') {
          if (chunk.text.length > 0) ctx.callbacks.onTextDelta(chunk.text, detectorState.totalSteps)
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
          detectorState.totalSteps,
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

    await result.consumeStream()

    const durationMs = Date.now() - segmentStart
    log.info(`[ReactLoop]   segment done. steps=${segmentStepCount} [${durationMs}ms]`)

    return detectorState.shouldStop
      ? { kind: 'detector-triggered', lastStep }
      : { kind: 'natural', lastStep }
  } catch (err) {
    // 异常路径 (abort / timeout / provider crash)
    log.error('[ReactLoop]   streamText threw:', err)
    if (lastStep === null) {
      // 没跑出任何 step — 兜底落一条 aborted 消息
      await persistAbortedStep({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        stepText: '',
        toolCallNames: [],
      })
      ctx.callbacks.onMessagePersisted?.(ctx.sessionId, detectorState.totalSteps)
    }
    return { kind: 'abort' }
  }
}
