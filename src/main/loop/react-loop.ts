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

import { streamText, type LanguageModel, type ModelMessage } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { toolResultPartsToBlocks, buildStreamSignal } from './stream-utils'
import { buildTools } from '../tools/build-tools'
import type { ReactLoopOptions, ReactLoopCallbacks } from './types'
import type { ContentBlock } from '@shared/types/message'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'

const DEFAULT_MAX_STEPS = 1000

const SEPARATOR = '──────────────────────────────────────────'
const DOUBLE_SEPARATOR = '══════════════════════════════════════════'

// ── 内部类型 ────────────────────────────────────────────────────────────

/** 单步 ReAct 所需的全部上下文（从 ReactLoopOptions 投射，去掉 maxSteps 等循环级参数）。 */
interface StepContext {
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
  /**
   * 本步的复合签名（sorted `toolName#inputHash:outputHash`），供顶层 dead-loop
   * 判断使用。包含 input 和 output hash：同工具 + 同参数 + 同结果连出现两次，
   * 基本可确定是死循环（模型不会在"同问题同答案"前提下有意义地推进）。
   * 没有工具调用的步返回空串。
   */
  signature: string
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
  | 'repeated_error'      // 连续相同工具错误（死循环保护）

function sha8(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8)
}

/**
 * 为一步的 tool 调用 + 返回计算复合签名，用于死循环侦测。
 *
 * 签名 = sorted `toolName#inputHash:outputHash`。
 * - inputHash: 参数 JSON 的 sha1 前 8 位
 * - outputHash: 输出文本前 500 字节的 sha1 前 8 位（大文件看不到整体，
 *   但头部 500 字节足够区分"同文件"和"不同文件"）
 *
 * 为什么比单看 toolName 靠谱：
 * - 仅 toolName：模型换不同文件路径做 read 也被判定同签名（假阳）
 * - 加 inputHash：参数变化即视为不同操作（消除假阳）
 * - 加 outputHash：若是错误反复（同 input 同 error 输出）必然同签名
 * - sorted：并行/乱序的多工具调用不因顺序扰动签名
 */
function stepSignature(
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>,
): string {
  if (toolCalls.length === 0) return ''
  return toolCalls
    .map((tc, i) => {
      const inputHash = sha8(JSON.stringify(tc.input ?? null))
      const outText = String(toolResults[i]?.output ?? '').slice(0, 500)
      const outputHash = outText ? sha8(outText) : 'none'
      return `${tc.toolName}#${inputHash}:${outputHash}`
    })
    .sort()
    .join('|')
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
  const stepStart = Date.now()

  const pipelineCtx = {
    sessionId: ctx.sessionId,
    currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    workspacePath: ctx.workspace || undefined,
    agent: ctx.agent,
    skillTracker: ctx.skillTracker,
    events: ctx.events,
  }
  const { messages, tools: toolSchemas } = await ctx.pipeline.build(pipelineCtx)

  const tools = await buildTools({
    sessionId: ctx.sessionId,
    messageId: ctx.messageId,
    workspace: ctx.workspace,
    confirmTool: ctx.confirmTool,
    requestPermission: ctx.requestPermission,
    agent: ctx.agent,
    toolSchemas,
    skillTracker: ctx.skillTracker,
  })

  log.info(`[ReactLoop] ${SEPARATOR} step ${stepIndex + 1}/${maxSteps} ${SEPARATOR}`)
  log.info(`[ReactLoop]   messages: ${messages.length} | provider: ${ctx.provider.name}`)

  const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
  let stepText = ''
  let persisted = false

  const result = streamText({
    model: ctx.model,
    messages,
    tools,
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
          agent_id: ctx.agentId,
        })
        sessionRepo.touch(ctx.sessionId)
        persisted = true
        return { stepText, hadToolCalls: false, wroteAssistantFinal: true, shouldContinue: false, durationMs, toolNames, exitReason: 'no_tool_calls', signature: '' }
      }
      log.info(`[ReactLoop]   → empty (no text, no tools) [${durationMs}ms]`)
      persisted = true   // 无东西可持久化，finally 不需兜底
      return { stepText: '', hadToolCalls: false, wroteAssistantFinal: false, shouldContinue: false, durationMs, toolNames, exitReason: 'empty_text', signature: '' }
    }

    // 有工具调用 → 落库 assistant + tool，继续下一步
    let toolResults = await result.toolResults
    if (toolResults.length === 0) {
      log.warn(`[ReactLoop]   → tools called but no results returned, injecting error feedback [${durationMs}ms]`)
      toolResults = stepToolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: `Tool not found: "${tc.toolName}". Available tools: ${ctx.agent.toolRegistry.getToolNames().join(', ')}`,
      }))
    }

    for (const tc of stepToolCalls) {
      log.info(`[ReactLoop]   → tool: ${tc.toolName} [${durationMs}ms]`)
    }
    log.info(`[ReactLoop]   → persist: assistant(${stepText ? 'text+' : ''}tool_use×${stepToolCalls.length}) + tool(result×${toolResults.length}) [tx]`)

    const assistantBlocks: ContentBlock[] = []
    if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
    for (const tc of stepToolCalls) {
      assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
    }

    const toolBlocks: ContentBlock[] = toolResultPartsToBlocks(toolResults)

    // 事务化：assistant(tool_use) 与 tool(result) 必须成对出现，否则下次
    // rebuild prompt 时 SDK 会抛 "Every tool_use must have a tool_result"，
    // 整个 session 被永久破坏。createBatch 保证原子落盘。
    messageRepo.createBatch([
      { id: uuidv4(), session_id: ctx.sessionId, role: 'assistant', content: assistantBlocks, agent_id: ctx.agentId },
      { id: uuidv4(), session_id: ctx.sessionId, role: 'tool',      content: toolBlocks,      agent_id: ctx.agentId },
    ])
    persisted = true

    const signature = stepSignature(stepToolCalls, toolResults)
    return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: true, durationMs, toolNames, signature }
  } catch (streamErr) {
    const durationMs = Date.now() - stepStart
    log.error(`[ReactLoop]   consumeStream failed (${durationMs}ms):`, streamErr)
    throw streamErr
  } finally {
    // 异常路径：abort / stream error / provider crash 时，把已累积的
    // stepText + stepToolCalls 尽力持久化为 aborted，前端刷新后能看到部分进展；
    // 若有 write/edit 已落盘，DB 也不会出现"无任何记录"的审计断层。
    if (!persisted && (stepText || stepToolCalls.length > 0)) {
      try {
        const abortedBlocks: ContentBlock[] = []
        const abortTag = stepToolCalls.length > 0
          ? `\n\n[step interrupted: tool results not returned]`
          : `\n\n[step interrupted]`
        if (stepText) {
          abortedBlocks.push({ type: 'text', text: `${stepText}${abortTag}` })
        } else {
          abortedBlocks.push({ type: 'text', text: abortTag.trimStart() })
        }
        // tool_use 不落库：没有对应 tool_result，保留会破坏 SDK 配对约束。
        // 仅用文字说明"调用过哪些工具"作为审计线索。
        if (stepToolCalls.length > 0) {
          const toolNamesStr = stepToolCalls.map(tc => tc.toolName).join(', ')
          abortedBlocks.push({ type: 'text', text: `[tools invoked this step: ${toolNamesStr} — no results returned]` })
        }
        messageRepo.create({
          id: uuidv4(),
          session_id: ctx.sessionId,
          role: 'assistant',
          content: abortedBlocks,
          agent_id: ctx.agentId,
        })
        sessionRepo.touch(ctx.sessionId)
        log.info(`[ReactLoop]   partial aborted step persisted (${abortedBlocks.length} blocks)`)
      } catch (persistErr) {
        log.error('[ReactLoop]   failed to persist partial aborted step:', persistErr)
      }
    }
  }
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
/**
 * 兜底时模型只能看到"之前的工具结果"，没有任何约束 prompt。
 * 此时最容易凭空编造结论，所以补一条强护栏，并把产出落库时打 ⚠️ 前缀，
 * 下一轮模型读到自己上轮是兜底，会更谨慎地复核。
 */
const FALLBACK_GUARDRAIL: ModelMessage = {
  role: 'system',
  content:
    '[Fallback summary mode]\n' +
    'You just made tool calls but produced no text output. Now briefly report to the user what you did and what was observed, ' +
    '**using only the content inside the <tool_output> tags above**. Strict rules:\n' +
    '1. Do not call any tools.\n' +
    '2. Do not invent facts, paths, file names, or numbers that did not appear in tool_output.\n' +
    '3. If any tool returned an error (File not found / [exit: non-zero] / ERROR / etc.), state the failure verbatim. Do not pretend it succeeded.\n' +
    '4. If the tool results are insufficient for a meaningful answer, say explicitly: "Task not completed because ...".',
}

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
      agent: ctx.agent,
      skillTracker: ctx.skillTracker,
      events: ctx.events,
    }
    const { messages } = await ctx.pipeline.build(summaryCtx)
    const summaryResult = streamText({
      model: ctx.model,
      messages: [...messages, FALLBACK_GUARDRAIL],
      abortSignal: buildStreamSignal(ctx.abortSignal),
    })
    let summaryText = ''
    for await (const chunk of summaryResult.textStream) {
      summaryText += chunk
      ctx.callbacks.onTextDelta(chunk)
    }
    const durationMs = Date.now() - summaryStart
    if (summaryText.trim()) {
      // 前缀 [auto-summary] 让下一轮模型读自己的历史时能识别"这不是一次正常推理，
      // 可能不完整或带错误"——配合 Fix 2 memory 的锚点策略一起抑制误差继承。
      const markedText = `[auto-summary]\n${summaryText}`
      messageRepo.create({
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: markedText }],
        agent_id: ctx.agentId,
      })
      sessionRepo.touch(ctx.sessionId)
      log.info(`[ReactLoop]   → summary: ${summaryText.length} chars [${durationMs}ms]`)
    } else {
      log.info(`[ReactLoop]   → summary: empty [${durationMs}ms]`)
    }
  } catch (err) {
    log.error(`[ReactLoop]   → summary failed [${Date.now() - summaryStart}ms]:`, err)
    throw err
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
  }

  let fullText = ''
  let wroteAssistantFinal = false
  let totalSteps = 0
  let totalToolCalls = 0
  let exitReason: LoopExitReason = 'no_tool_calls'
  const allToolNames: string[] = []

  // Dead-loop detection. 签名含 input + output hash，见 stepSignature 注释。
  // 阈值 2：同签名连续出现 3 次（初次 + 2 次重复）即判定死循环。实测 3 次足以
  // 穿透"模型偶尔重试一次"的合理行为。注意：stepText 非零**不再** reset 计数——
  // 模型可能一边喷无意义 token 一边反复调同参同果工具，不能因此放行。
  const REPEATED_ERROR_THRESHOLD = 2
  let lastStepSignature = ''
  let consecutiveRepeatCount = 0

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

    if (outcome.signature) {
      if (outcome.signature === lastStepSignature) {
        consecutiveRepeatCount++
        if (consecutiveRepeatCount >= REPEATED_ERROR_THRESHOLD) {
          log.warn(`[ReactLoop] Dead loop: signature "${outcome.signature}" repeated ${consecutiveRepeatCount + 1}x (same tools + inputs + outputs). Breaking.`)
          exitReason = 'repeated_error'
          break
        }
      } else {
        lastStepSignature = outcome.signature
        consecutiveRepeatCount = 0
      }
    } else {
      // 无工具调用的步（纯文本 / empty）不参与重复判定，也不 reset——
      // 避免模型在死循环中穿插一步纯思考就逃脱侦测。
    }

    if (!outcome.shouldContinue) {
      exitReason = outcome.exitReason ?? 'no_tool_calls'
      break
    }
    if (step === maxSteps - 1) {
      exitReason = 'max_steps'
    }
  }

  // 兜底摘要：整轮一字没吐且非 abort → 强制一次无工具 streamText
  if (!wroteAssistantFinal && fullText.length === 0 && exitReason !== 'abort') {
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
