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
import { buildStreamTimeout } from './stream-utils'
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
import { SignatureDeadLoop } from './detectors/signature-dead-loop'
import { LengthTruncationStreak } from './detectors/length-truncation-streak'
import type { Detector } from './detectors/types'
import { FailureStreakReflector } from './reflect/failure-streak'
import { ToolOnlyLoopReflector } from './reflect/tool-only-loop'
import { JudgeCompletionReflector } from './reflect/judge-completion'
import { ContextBudgetReflector } from './reflect/context-budget'
import { PeriodicReflector } from './reflect/periodic'
import { EscalationReflector } from './reflect/escalation'
import { QuoteCorrectionReflector } from './reflect/quote-correction'
import { runReflectorChain } from './reflect/chain'
import type { Reflector } from './reflect/types'
import { reflectionLedger } from '../repos/reflection-ledger'
import {
  buildDefaultChain,
  runPolicyChain,
  type TurnEndPolicy,
  type PolicyContext,
} from './turn-end-policies'
import { factsFromStep, outcomeFromStep, extractTextFromStep } from './step-adapter'
import { persistStepFromResult, persistAbortedStep } from './persist-step'
import { recordUsage } from '../providers/usage-recorder'

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

/** 跨 step 共享的运行时状态。reflectModel 沿用主对话 model (类似 ShortTermMemory 压缩 agent)。 */
interface ReflectRuntime {
  /** runReactStep 入口 pre-step chain 用 (context-budget 等). 只放 pre-step reflectors. */
  preStepReflectors: readonly Reflector[]
  perTurnCounters: Map<string, number>
  recentHistory: import('./types').StepOutcome[]
  reflectModel: import('ai').LanguageModel
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
  const sharedSignatureDeadLoop = new SignatureDeadLoop(ctx)
  const sharedLengthTruncation = new LengthTruncationStreak()
  const detectors: Detector[] = [sharedSignatureDeadLoop, sharedLengthTruncation]

  // Reflector chain — 按 phase 显式分组. 混合体 (Detector + Reflector 双接口)
  // 在 detectors[] + postStepReflectors[] 同时引用 (同一实例, 共享 state)。
  // reflectModel 沿用主对话 model (参考 ShortTermMemory 压缩 agent), 无独立配置。
  const reflectModel = opts.model
  // mutable closure 跨 step 跟踪上步是否有 L1 reflector 输出 hint。
  // EscalationReflector 用此判定 L1 hint 连续 N 步未生效 → 升级 LLM reflect。
  let lastL1Hinted = false

  const preStepReflectors: Reflector[] = [new ContextBudgetReflector()]

  const postStepReflectors: Reflector[] = [
    // 混合体先跑, 复用 detector state (priority=20 < 默认 100)
    sharedSignatureDeadLoop,
    sharedLengthTruncation,
    new FailureStreakReflector(ctx),
    new ToolOnlyLoopReflector(),
    new PeriodicReflector({ every: 5 }),
    new EscalationReflector({
      wasPreviousStepL1Hinted: () => lastL1Hinted,
    }),
  ]

  const turnEndReflectors: Reflector[] = [
    new JudgeCompletionReflector({ sessionId: opts.sessionId }),
    new QuoteCorrectionReflector(),
  ]

  const perTurnCounters = new Map<string, number>()
  const recentHistory: import('./types').StepOutcome[] = []
  const runtime: ReflectRuntime = {
    preStepReflectors,
    perTurnCounters,
    recentHistory,
    reflectModel,
  }

  let exitReason: LoopExitReason = 'no_tool_calls'
  let nextPolicyHint: string | null = null
  let lastInputTokens: number | undefined

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }

    const hint = nextPolicyHint
    nextPolicyHint = null

    const { expand: mcpExpand, used: mcpUsed } = mcpState.flags

    let stepResult: StepRunResult
    try {
      stepResult = await runReactStep(ctx, runtime, step, maxSteps, {
        hint,
        mcpExpand,
        mcpUsed,
        lastInputTokens,
        persistUserOutput: (sIdx, from, u) => persistUserOutput(opts, sIdx, from, u),
        persistInternalNudge: (sIdx, from, n) => persistInternalNudge(opts, sIdx, from, n),
      })
    } catch (err) {
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
      log.warn(`[ReactLoop] step ${step} returned null step without exit reason`)
      break
    }

    if (stepResult.lastInputTokens) lastInputTokens = stepResult.lastInputTokens

    const outcome = outcomeFromStep(stepResult.step, stepResult.durationMs)
    accumulator.observe(outcome)
    mcpState.update(outcome)
    recentHistory.push(outcome)
    if (recentHistory.length > 20) recentHistory.shift()

    const facts = factsFromStep(stepResult.step)
    const rawCtx = { stepText: outcome.stepText, finishReason: outcome.finishReason }

    // ── Detector chain — 硬切断侦测 (代码判定) ──
    let detectorBreak: { exitReason: LoopExitReason } | null = null
    for (const d of detectors) {
      const verdict = d.observe(facts, step, rawCtx)
      if (!verdict.triggered) continue
      log.warn(`[ReactLoop] Detector "${d.name}" triggered (exit=${verdict.exitReason})`)
      detectorBreak = { exitReason: verdict.exitReason ?? 'repeated_error' }
      break
    }

    // ── Mid-turn Reflector chain (aboutToFinal=false) ──
    const commonReflectFields = {
      stepIndex: step,
      userIntent: opts.userContent,
      sessionId: opts.sessionId,
      abortSignal: opts.abortSignal,
      recentHistory: recentHistory.slice(),
      reflectModel: reflectModel ?? undefined,
    }
    const midOut = await runReflectorChain(
      'post-step',
      postStepReflectors,
      { ...commonReflectFields, phase: 'post-step', facts, outcome, raw: rawCtx },
      perTurnCounters,
    )

    // 跟踪 L1 hint 注入: EscalationReflector 据此决定何时升级 LLM reflect。
    lastL1Hinted =
      midOut.kind === 'hint' &&
      (midOut.from === 'failure-streak' || midOut.from === 'tool-only-loop')

    // 决策优先级: wrapUp > detectorBreak > userOutput > policy > internalNudge > hint
    //   wrapUp / userOutput  → 用户回复, break turn
    //   internalNudge        → 内部纠正, 持久化为非 assistant 消息, continue loop
    //   hint                 → 临时引导, 注入下一步 system message
    if (midOut.wrapUp) {
      try {
        await midOut.wrapUp.runSummary()
      } catch (e) {
        log.error(`[ReactLoop] reflector "${midOut.from}" wrap-up failed:`, e)
      }
      if (midOut.wrapUp.markFinal) accumulator.markFinal()
      exitReason = midOut.wrapUp.exitReason
      break
    }
    if (detectorBreak) {
      exitReason = detectorBreak.exitReason
      break
    }
    if (midOut.userOutput) {
      await persistUserOutput(opts, step, midOut.from ?? 'unknown', midOut.userOutput)
      exitReason = midOut.userOutput.exitReason ?? 'no_tool_calls'
      break
    }
    if (midOut.internalNudge) {
      await persistInternalNudge(opts, step, midOut.from ?? 'unknown', midOut.internalNudge)
      // 已落库为非 assistant 消息, 下次 pipeline.build 读到, 主 LLM 续做
      continue
    }

    // ── Turn-end policy (无 tool 时) ──
    let policyDecision: 'final' | 'continue' | null = null
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
        sdkSignals: stepResult.sdkSignals ?? { finishReason: outcome.finishReason ?? 'stop' },
      }
      const decision = await runPolicyChain(turnEndPolicies, outcome, policyCtx)
      policyDecision = decision.action === 'final' ? 'final' : 'continue'
      if (decision.action === 'continue') {
        log.info(`[ReactLoop]   → CONTINUE by policy`)
        nextPolicyHint = decision.injectHint ?? null
      } else if (decision.action !== 'final') {
        log.warn(`[ReactLoop]   policy chain no-opinion; treating as FINAL`)
        exitReason = 'no_tool_calls'
        break
      }
    }

    // ── End Reflector chain (仅 policy='final' 时) ──
    if (policyDecision === 'final') {
      const endOut = await runReflectorChain(
        'turn-end',
        turnEndReflectors,
        {
          ...commonReflectFields,
          phase: 'turn-end',
          facts,
          outcome,
          raw: rawCtx,
          policyDecision: 'final',
        },
        perTurnCounters,
      )
      if (endOut.userOutput) {
        await persistUserOutput(opts, step, endOut.from ?? 'unknown', endOut.userOutput)
        exitReason = endOut.userOutput.exitReason ?? 'no_tool_calls'
        break
      }
      if (endOut.internalNudge) {
        // judge 推翻 final: 落库内部纠正 + 强制下一步 expand MCP 全集
        // (上一步为 final 纯文本, mcpState.update 会把 expandNext 设为 false,
        // 必须重置避免 mcp 工具丢失)
        await persistInternalNudge(opts, step, endOut.from ?? 'unknown', endOut.internalNudge)
        mcpState.forceExpandNext()
        continue
      }
      log.info(`[ReactLoop]   → FINAL by policy`)
      exitReason = 'no_tool_calls'
      break
    }

    // mid-reflector advisor hint 仅在没有 policy hint 时注入下步
    if (midOut.hint && !nextPolicyHint) nextPolicyHint = midOut.hint

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

// ── 持久化 reflect outcome ────────────────────────────────────────────────
//
// 两种用途, 两个函数, 严格分离:
//   persistUserOutput     — 用户回复, role='assistant', 触发 UI 流式渲染
//   persistInternalNudge  — 内部纠正, role=u.role (通常 'user'), 不触发 UI 流式
//                           主 LLM 下步读 history 把它当 "外部审查反馈" 续做

async function persistUserOutput(
  opts: ReactLoopOptions,
  stepIndex: number,
  reflectorName: string,
  u: import('./reflect/types').UserOutput,
): Promise<void> {
  const text = `${u.label} ${u.text}`
  messageRepo.create({
    id: uuidv4(),
    session_id: opts.sessionId,
    role: 'assistant',
    content: [{ type: 'text', text }],
    agent_id: opts.agent.id,
  })
  sessionRepo.touch(opts.sessionId)
  opts.callbacks.onTextDelta(text, stepIndex)
  opts.callbacks.onMessagePersisted?.(opts.sessionId, stepIndex)
  reflectionLedger.record({
    sessionId: opts.sessionId,
    stepIndex,
    reflector: reflectorName,
    outputKind: 'user_output',
    direct: { text: u.text, label: u.label },
    reason: u.reason,
  })
}

async function persistInternalNudge(
  opts: ReactLoopOptions,
  stepIndex: number,
  reflectorName: string,
  n: import('./reflect/types').InternalNudge,
): Promise<void> {
  const text = `${n.label} ${n.text}`
  messageRepo.create({
    id: uuidv4(),
    session_id: opts.sessionId,
    role: n.role,
    content: [{ type: 'text', text }],
    agent_id: opts.agent.id,
  })
  sessionRepo.touch(opts.sessionId)
  // 关键: 不调 onTextDelta. UI 不渲染本条 — internalNudge 是给主 LLM 看的内部纠正,
  // 用户应该看到的是主 LLM 续做后的下一条 assistant 消息, 而非这条 user/system 形态
  // 的审查指令。renderer 端按 role 过滤或按 label 折叠都行。
  opts.callbacks.onMessagePersisted?.(opts.sessionId, stepIndex)
  reflectionLedger.record({
    sessionId: opts.sessionId,
    stepIndex,
    reflector: reflectorName,
    outputKind: 'internal_nudge',
    direct: { text: n.text, label: n.label },
    reason: n.reason,
  })
}

// ── runReactStep — 单步 = 一次 streamText 调用 ──────────────────────────

async function runReactStep(
  ctx: LoopCtx,
  runtime: ReflectRuntime,
  stepIndex: number,
  maxSteps: number,
  state: {
    hint: string | null
    mcpExpand: boolean
    mcpUsed: string[]
    lastInputTokens?: number
    persistUserOutput: (
      stepIdx: number,
      from: string,
      u: import('./reflect/types').UserOutput,
    ) => Promise<void>
    persistInternalNudge: (
      stepIdx: number,
      from: string,
      n: import('./reflect/types').InternalNudge,
    ) => Promise<void>
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

  // 2. Pre-step Reflector chain (context-budget + 未来 pre-step reflectors)
  const limit = ctx.providerConfig.context_limit
  let estimatedTokens = 0
  if (limit > 0) {
    if (state.lastInputTokens && state.lastInputTokens > 0) {
      estimatedTokens = state.lastInputTokens
    } else {
      for (const m of messages) {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        estimatedTokens += estimate(text)
      }
    }
  }
  const preOut = await runReflectorChain(
    'pre-step',
    runtime.preStepReflectors,
    {
      phase: 'pre-step',
      stepIndex,
      userIntent: ctx.userContent,
      sessionId: ctx.sessionId,
      abortSignal: ctx.abortSignal,
      recentHistory: runtime.recentHistory.slice(),
      reflectModel: runtime.reflectModel ?? undefined,
      estimatedTokens,
      contextLimit: limit,
      messages,
    },
    runtime.perTurnCounters,
  )
  if (preOut.userOutput) {
    // pre-step 输出 userOutput 仅 context_overflow 一种场景 (auto-halt)
    await state.persistUserOutput(stepIndex, preOut.from ?? 'unknown', preOut.userOutput)
    return {
      step: null,
      durationMs: Date.now() - stepStart,
      exitReason: 'context_overflow',
    }
  }
  if (preOut.internalNudge) {
    // pre-step internalNudge 不预期 (当前无 reflector 在 pre-step 输出 nudge), 防御性兼容
    await state.persistInternalNudge(stepIndex, preOut.from ?? 'unknown', preOut.internalNudge)
  }
  if (preOut.hint) {
    messages.push({ role: 'system', content: preOut.hint })
    log.info(`[ReactLoop]   pre-step hint injected (${preOut.hint.length} chars)`)
  }
  // wrapUp from pre-step 不预期; 若发生, runReflectorChain 会返回但主循环不处理 wrapUp (pre-step 不该有)

  // 3. Hint 注入 (上一步留下的 nextPolicyHint / mid-reflector advisor)
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

  // 5. streamText 参数 — 极简:不再读 agent preferences,仅用 provider config + 默认
  const provider = ctx.provider
  const streamParams: Record<string, unknown> = {
    maxOutputTokens: provider.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    maxRetries: provider.max_retries,
    headers: provider.headers,
  }
  if (provider.request_timeout_ms !== undefined) streamParams.timeout = provider.request_timeout_ms
  const adapterProviderOpts =
    (ctx.streamOptions as { providerOptions?: Record<string, unknown> } | undefined)
      ?.providerOptions ?? {}
  streamParams.providerOptions = { ...adapterProviderOpts, ...(provider.provider_options ?? {}) }

  log.info(`[ReactLoop] ${SEPARATOR} step ${stepIndex + 1}/${maxSteps} ${SEPARATOR}`)
  log.info(`[ReactLoop]   messages: ${messages.length} | provider: ${ctx.provider.name}`)

  // 6. streamText (single step — stepCountIs(1) 显式)
  // 流超时 = 模型不活跃超时,工具执行期暂停(delegate_agent / 慢 MCP 在 step 内执行,
  // 不应计入流超时;delegate 有自己的 executionTimeoutMs 预算)。见 stream-utils。
  const streamTimeout = buildStreamTimeout(ctx.abortSignal)
  const result = streamText({
    model: ctx.model,
    messages,
    tools,
    ...ctx.streamOptions,
    ...streamParams,
    abortSignal: streamTimeout.signal,
    stopWhen: stepCountIs(1),

    onChunk({ chunk }) {
      streamTimeout.ping() // 模型在产出 → 重置不活跃计时
      if (chunk.type === 'text-delta' && chunk.text.length > 0) {
        ctx.callbacks.onTextDelta(chunk.text, stepIndex)
      }
    },

    experimental_onToolCallStart({ toolCall }) {
      streamTimeout.pause() // 工具执行期不计入流超时
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
      streamTimeout.resume() // 工具结束 → 恢复不活跃计时
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

    // 8.5 统计本步 token 用量(主对话) — usage/providerMetadata 来自 SDK, 累加到 session
    recordUsage(ctx.sessionId, usage, providerMetadata as Record<string, unknown> | undefined)

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
  } finally {
    streamTimeout.dispose() // 清理流超时 timer(无论成功/异常)
  }
}
