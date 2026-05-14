// src/main/loop/react-loop.ts —— 业务层：ReAct 多步推理引擎
//
// 公开接口：runReactLoop(opts)
//
// 内部结构（Phase 1B 优化后）：
//   runReactLoop  —— 顶层调度: 遍历 detectors[] + 触发 forced summary
//   runReactStep  —— 单步 ReAct（build prompt → stream → persist）
//
// 检测器分布:
//   src/main/loop/detectors/
//     signature-dead-loop / failure-streak / tool-only-loop
//
// 强制摘要、累积状态、MCP 暴露状态、Outcome 派生信号已抽到各自模块。
//
// 允许依赖：loop/*、repos/*、shared/*
// 禁止依赖：ipc/*

import { streamText, type LanguageModel, type AssistantContent, type ToolContent } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import {
  buildStreamSignal,
  isErrorOutput,
  extractOutputText,
  truncateOutput,
  wrapToolOutput,
} from './stream-utils'
import { buildTools } from '../tools/build-tools'
import { estimate } from '../memory/types'
import type { ReactLoopOptions, ReactLoopCallbacks, StepOutcome, LoopExitReason } from './types'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { classify } from './outcome-facts'
import { parseTalorBlocks } from '@shared/talor-blocks/talor-block-parser'
import { LoopAccumulator } from './loop-accumulator'
import { McpExposureState } from './mcp-exposure-state'
import { runForcedSummary, FALLBACK_SUMMARY_OPTS } from './forced-summary'
import { composeHint } from './compose-hint'
import { SignatureDeadLoopDetector } from './detectors/signature-dead-loop'
import { FailureStreakDetector } from './detectors/failure-streak'
import { ToolOnlyLoopDetector } from './detectors/tool-only-loop'

/**
 * 单步 prompt 估算到达该比例时,提醒模型收敛。
 * ShortTermMemory 90% 触发压缩后,已压缩过的 prompt 再次超此阈值意味着
 * 纯粹的工具输出/recent 段已经吃满窗口,继续跑可能被 provider 静默截断。
 */
const CONTEXT_USAGE_WARNING_RATIO = 0.98

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
  streamOptions?: Record<string, unknown>
  /** v3.6: 本 turn 起始时刻 (ISO),透传给 forced-summary 做 ledger 划界 */
  turnStartTime: string
}

// StepOutcome / LoopExitReason 已迁移到 ./types.ts (Phase 1B 优化)

function sha8(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8)
}

/**
 * E1: 检测 tool result 是否是 delegate_agent 返回的 SUBAGENT_ 或 DELEGATION_
 * 类失败 envelope。这些信号的"成本"比普通 tool 错误更高,父 loop 应加权计入 streak。
 */
function isSubagentFailureOutput(output: unknown): boolean {
  if (typeof output !== 'object' || output === null) return false
  const env = output as Record<string, unknown>
  if (env.__talor_error !== true) return false
  if (typeof env.code !== 'string') return false
  const code = env.code
  return (
    code.startsWith('SUBAGENT_') ||
    code === 'DELEGATION_BUDGET_EXHAUSTED' ||
    code === 'INSTRUCTION_OUT_OF_SCOPE' ||
    code === 'DELEGATION_QUEUE_TIMEOUT'
  )
}

// stripToolCallMarkup 已迁移至 ./forced-summary.ts (内部 helper)

/**
 * 对任意 JSON 值做规范化序列化:递归对对象键排序,确保键顺序差异不影响 hash。
 * 目的:同命令的两次调用即使字段顺序不同(模型生成的 JSON 可能顺序不稳定),
 * 也产出相同的 inputHash。不丢任何字段(不做黑名单过滤,避免丢失语义信息)。
 */
function canonicalizeJson(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalizeJson).join(',') + ']'
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return (
    '{' + entries.map(([k, val]) => JSON.stringify(k) + ':' + canonicalizeJson(val)).join(',') + '}'
  )
}

/**
 * 从 tool_result output 中抽出 raw 段做 hash。
 *
 * tool_result body 结构:[通用指引] + "---" + "[Raw output]\n" + <raw>。
 * 所有工具共用同一段 ~2KB 的指引前缀,如果对整条 output 做 hash 会导致
 * 不同 raw 内容的 output 前 500 字节都相同 → outputHash 失效。
 *
 * 抽取 `[Raw output]\n` 标签之后的前 500 字节作为 hash 输入。标签缺失时
 * fallback 到整条 output(兼容旧格式 / 单测用的简单 output)。
 */
function extractRawForHash(output: string): string {
  const marker = '[Raw output]\n'
  const idx = output.indexOf(marker)
  const raw = idx === -1 ? output : output.slice(idx + marker.length)
  return raw.slice(0, 500)
}

/**
 * 为一步的 tool 调用 + 返回计算复合签名,用于死循环侦测。
 *
 * 签名 = sorted `toolName#inputHash:outputHash`。
 * - inputHash: canonical 化后的参数 JSON 的 sha1 前 8 位(忽略键顺序差异)
 * - outputHash: raw 段前 500 字节的 sha1 前 8 位(跳过通用指引前缀)
 *
 * 设计要点:
 * - 仅 toolName 无法区分"不同文件的 read"——加 input hash
 * - input hash 对键顺序无感,避免同命令因形式差异被判定为不同
 * - output hash 跳过指引前缀,保证不同 raw 产出不同 hash
 * - sorted:并行/乱序的多工具调用不因顺序扰动签名
 */
function stepSignature(
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>,
): string {
  if (toolCalls.length === 0) return ''
  return toolCalls
    .map((tc, i) => {
      const inputHash = sha8(canonicalizeJson(tc.input))
      const outText = extractRawForHash(String(toolResults[i]?.output ?? ''))
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
async function runReactStep(
  ctx: StepContext,
  stepIndex: number,
  maxSteps: number,
  mcpExpandThisStep: boolean,
  usedMcpToolNames: string[],
  /** 渐进式失败提示——streak=2 时由 runReactLoop 注入，让模型在最后机会前自我修正。 */
  failureHintMessage: string | null,
): Promise<StepOutcome> {
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
    mcpExpandThisStep,
    usedMcpToolNames,
  }
  const { messages, tools: toolSchemas } = await ctx.pipeline.build(pipelineCtx)

  // Token 预算预检。
  // >=100%: 硬阻断。provider 收到超限 prompt 通常会静默截掉 system 段,模型
  //        看不到规则后开始凭空推断,这是真实的生产事故模式。与其提交请求后
  //        祈祷 provider 手下留情,不如本地短路,给用户一条明确的 halt 消息。
  // >98%:  软告警,追加 [CONTEXT NEARLY FULL] 让模型自觉收敛。
  const limit = ctx.providerConfig.context_limit
  if (limit > 0) {
    let estimatedTokens = 0
    for (const m of messages) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      estimatedTokens += estimate(text)
    }
    const usageRatio = estimatedTokens / limit

    if (usageRatio >= 1.0) {
      log.error(
        `[ReactLoop]   context overflow: ${estimatedTokens}/${limit} (${(usageRatio * 100).toFixed(1)}%). Halting before submission.`,
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
      return {
        stepText: haltText,
        wroteAssistantFinal: true,
        shouldContinue: false,
        durationMs: Date.now() - stepStart,
        toolNames: [],
        exitReason: 'context_overflow',
        signature: '',
        allToolsFailed: null,
        containsSubagentFailure: false,
      }
    }

    if (usageRatio > CONTEXT_USAGE_WARNING_RATIO) {
      log.warn(
        `[ReactLoop]   context near overflow: ${estimatedTokens}/${limit} (${(usageRatio * 100).toFixed(1)}%)`,
      )
      messages.push({
        role: 'system',
        content:
          `[CONTEXT NEARLY FULL] Prompt is using ~${(usageRatio * 100).toFixed(0)}% of the available window. ` +
          `Prefer concise responses and avoid large tool outputs. Finish any in-progress task first, ` +
          `then summarize.`,
      })
    }
  }

  // stepText 必须在 buildTools 之前声明 — buildTools 的 getCurrentStepBlocks
  // getter 需要闭包捕获此变量, 才能在 tool execute 时取到最新累积的文本。
  let stepText = ''

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
    // v3.6 流式: 每次 tool execute 时实时 parse stepText, RiskGate 据此走主路径
    getCurrentStepBlocks: () => parseTalorBlocks(stepText).blocks,
    // v3.6 Ledger: 透传 step_index, RiskGate.recordLedger 用
    stepIndex,
    // subagent 暂未引入嵌套 buildTools; 顶层 buildTools 当前总是 root
    parentSessionIdForLedger: null,
  })

  if (failureHintMessage) {
    messages.push({ role: 'system', content: failureHintMessage })
    log.info(`[ReactLoop]   injected failure-streak hint`)
  }

  log.info(`[ReactLoop] ${SEPARATOR} step ${stepIndex + 1}/${maxSteps} ${SEPARATOR}`)
  log.info(`[ReactLoop]   messages: ${messages.length} | provider: ${ctx.provider.name}`)

  const stepToolCalls: Array<{
    toolCallId: string
    toolName: string
    input: unknown
    startedAt: number
  }> = []
  // 跟踪本步通过 experimental_onToolCallFinish 已解决的 toolCallId。
  // 该回调对 success / error 都会触发,正常情况下应当全部解决。这里保留 Set
  // 仅作为兜底:若某个 toolCallId 走了非常规路径 (SDK 取消、未来 API 变更
  // 等),consumeStream 之后用 result.steps 对账,给未解决的发一个错误结果。
  const stepResolvedToolCallIds = new Set<string>()
  let stepReasoning = ''
  let persisted = false

  const result = streamText({
    model: ctx.model,
    messages,
    tools,
    ...ctx.streamOptions,
    abortSignal: buildStreamSignal(ctx.abortSignal),
    onChunk({ chunk }) {
      // 只处理文本类 chunk:tool-call / tool-result chunk 在 AI SDK v6 内部被
      // 等到 execute() 完成后一起 flush,放在这里会导致 spinner 闪 1ms 就消失。
      // 工具生命周期改用 experimental_onToolCallStart / Finish(execute 前后实时触发)。
      if (chunk.type === 'text-delta') {
        stepText += chunk.text
        if (chunk.text.length > 0) ctx.callbacks.onTextDelta(chunk.text, stepIndex)
      } else if (chunk.type === 'reasoning-delta') {
        stepReasoning += chunk.text
      }
    },
    experimental_onToolCallStart({ toolCall }) {
      const startedAt = Date.now()
      stepToolCalls.push({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        startedAt,
      })
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
      stepResolvedToolCallIds.add(event.toolCall.toolCallId)
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

  try {
    await result.consumeStream()

    // SDK 层 tool-error 不进 onChunk;对未解决的 toolCallId 主动发一个错误结果,
    // 否则渲染端的 spinner 永远卡在 pending。
    const sdkSteps = await result.steps
    for (const tc of stepToolCalls) {
      if (stepResolvedToolCallIds.has(tc.toolCallId)) continue
      const sdkResult = sdkSteps
        .flatMap((s) => s.content)
        .find(
          (p) =>
            (p.type === 'tool-result' || p.type === 'tool-error') && p.toolCallId === tc.toolCallId,
        )
      const errMsg =
        sdkResult && sdkResult.type === 'tool-error'
          ? sdkResult.error instanceof Error
            ? sdkResult.error.message
            : typeof sdkResult.error === 'string'
              ? sdkResult.error
              : JSON.stringify(sdkResult.error)
          : 'tool returned no result'
      log.warn(`[ReactLoop]   → reconcile tool-error: ${tc.toolName} ${errMsg}`)
      ctx.callbacks.onToolResult(
        tc.toolCallId,
        tc.toolName,
        { __talor_error: true, code: 'SDK_TOOL_ERROR', message: errMsg },
        Date.now() - tc.startedAt,
      )
    }

    const durationMs = Date.now() - stepStart
    const toolNames = stepToolCalls.map((tc) => tc.toolName)

    // v3.7: 无工具调用 + 有文本 → 自然 final (信任 LLM 自然语言结束)。
    // 不再区分"显式 marker / 隐式问句 / no-marker streak":现代 LLM 不发 marker
    // 也是合法结束 (问号本身就是信号, "无法做"就是 blocked 语义)。
    // UI 渲染层用 inferIntent 启发式分类 (Phase B) 决定卡片样式。
    if (stepToolCalls.length === 0) {
      if (stepText) {
        log.info(
          `[ReactLoop]   → text: ${stepText.length} chars (no tools) [${durationMs}ms] — natural FINAL`,
        )
        log.info(`[ReactLoop]   → persist: assistant(text) [FINAL]`)
        const finalParts: AssistantContent = []
        if (stepReasoning) finalParts.push({ type: 'reasoning', text: stepReasoning })
        finalParts.push({ type: 'text', text: stepText })
        messageRepo.create({
          id: ctx.messageId,
          session_id: ctx.sessionId,
          role: 'assistant',
          content: finalParts,
          agent_id: ctx.agentId,
        })
        sessionRepo.touch(ctx.sessionId)
        ctx.callbacks.onMessagePersisted?.(ctx.sessionId, stepIndex)
        persisted = true
        return {
          stepText,
          wroteAssistantFinal: true,
          shouldContinue: false,
          durationMs,
          toolNames,
          exitReason: 'no_tool_calls',
          signature: '',
          allToolsFailed: null,
          containsSubagentFailure: false,
        }
      }
      log.info(`[ReactLoop]   → empty (no text, no tools) [${durationMs}ms]`)
      persisted = true // 无东西可持久化，finally 不需兜底
      return {
        stepText: '',
        wroteAssistantFinal: false,
        shouldContinue: false,
        durationMs,
        toolNames,
        exitReason: 'empty_text',
        signature: '',
        allToolsFailed: null,
        containsSubagentFailure: false,
      }
    }

    // 有工具调用 → 落库 assistant + tool,继续下一步
    let toolResults: Awaited<typeof result.toolResults> = await result.toolResults
    if (toolResults.length === 0) {
      // toolResults 空有三类原因:
      //   a) 工具名根本不在 registry(模型编造了工具名)
      //   b) MCP 工具在 registry 但 search_tool 还没被调过(尚未注入到 tools)
      //   c) 工具暴露了但执行路径失败(MCP 崩溃/SDK 解析失败/超时)
      // 三者反馈差异巨大:a) 改名重试; b) 先调 search_tool; c) 必须停手。
      const registeredNames = ctx.agent.toolRegistry.getToolNames()
      const exposedNames = new Set(toolSchemas.map((t) => t.name))
      const mcpToolNames = new Set(ctx.agent.toolRegistry.listMcpTools().map((t) => t.name))
      toolResults = stepToolCalls.map((tc) => {
        let output: string
        if (!registeredNames.includes(tc.toolName)) {
          output = `Tool not found: "${tc.toolName}". Available tools: ${registeredNames.join(', ')}`
        } else if (!exposedNames.has(tc.toolName) && mcpToolNames.has(tc.toolName)) {
          output =
            `MCP tool "${tc.toolName}" is not yet loaded in your tool set. ` +
            `Call \`search_tool\` first to load all MCP tools, then re-issue this tool call.`
        } else {
          output =
            `Tool execution failed: "${tc.toolName}" was invoked but returned no result ` +
            `(likely transport error, timeout, or MCP server crash). ` +
            `Retrying with the same parameters is unlikely to help — try a different approach, ` +
            `adjust the parameters, or fall back to another tool.`
        }
        return {
          type: 'tool-result' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
          output,
          dynamic: true as const,
        }
      }) as typeof toolResults
      log.warn(
        `[ReactLoop]   → toolResults empty, injected differentiated feedback [${durationMs}ms]`,
      )
    }

    for (const tc of stepToolCalls) {
      log.info(`[ReactLoop]   → tool: ${tc.toolName} [${durationMs}ms]`)
    }
    log.info(
      `[ReactLoop]   → persist: assistant(${stepText ? 'text+' : ''}tool_use×${stepToolCalls.length}) + tool(result×${toolResults.length}) [tx]`,
    )

    const assistantParts: AssistantContent = []
    if (stepReasoning) assistantParts.push({ type: 'reasoning', text: stepReasoning })
    if (stepText) assistantParts.push({ type: 'text', text: stepText })
    for (const tc of stepToolCalls) {
      assistantParts.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })
    }

    const toolParts: ToolContent = toolResults.map((tr) => {
      const rawText = extractOutputText(tr.output)
      const truncated =
        tr.toolName === 'skill' ? rawText.slice(0, 1_000_000) : truncateOutput(rawText)
      return {
        type: 'tool-result' as const,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        output: {
          type: 'text' as const,
          value: wrapToolOutput(tr.toolName, truncated, tr.toolName === 'skill'),
        },
        isError: isErrorOutput(tr.output),
      }
    })

    // 事务化：assistant(tool_use) 与 tool(result) 必须成对出现，否则下次
    // rebuild prompt 时 SDK 会抛 "Every tool_use must have a tool_result"，
    // 整个 session 被永久破坏。createBatch 保证原子落盘。
    messageRepo.createBatch([
      {
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: assistantParts,
        agent_id: ctx.agentId,
      },
      {
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'tool',
        content: toolParts,
        agent_id: ctx.agentId,
      },
    ])
    ctx.callbacks.onMessagePersisted?.(ctx.sessionId, stepIndex)
    persisted = true

    const signature = stepSignature(stepToolCalls, toolResults)
    const allToolsFailed =
      toolParts.length > 0 &&
      toolParts.every(
        (p) => p.type === 'tool-result' && (p as unknown as { isError?: boolean }).isError === true,
      )
    // E1: 任一 tool result 是 SUBAGENT_*/DELEGATION_* envelope 即标记
    const containsSubagentFailure = toolResults.some((tr) => isSubagentFailureOutput(tr.output))
    return {
      stepText,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs,
      toolNames,
      signature,
      allToolsFailed,
      containsSubagentFailure,
    }
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
        const abortedParts: AssistantContent = []
        const abortTag =
          stepToolCalls.length > 0
            ? `\n\n[step interrupted: tool results not returned]`
            : `\n\n[step interrupted]`
        if (stepText) {
          abortedParts.push({ type: 'text', text: `${stepText}${abortTag}` })
        } else {
          abortedParts.push({ type: 'text', text: abortTag.trimStart() })
        }
        if (stepToolCalls.length > 0) {
          const toolNamesStr = stepToolCalls.map((tc) => tc.toolName).join(', ')
          abortedParts.push({
            type: 'text',
            text: `[tools invoked this step: ${toolNamesStr} — no results returned]`,
          })
        }
        messageRepo.create({
          id: uuidv4(),
          session_id: ctx.sessionId,
          role: 'assistant',
          content: abortedParts,
          agent_id: ctx.agentId,
        })
        sessionRepo.touch(ctx.sessionId)
        ctx.callbacks.onMessagePersisted?.(ctx.sessionId, stepIndex)
        log.info(`[ReactLoop]   partial aborted step persisted (${abortedParts.length} parts)`)
      } catch (persistErr) {
        log.error('[ReactLoop]   failed to persist partial aborted step:', persistErr)
      }
    }
  }
}
// 已迁移至 forced-summary.ts: collectRecentToolOutputs, FALLBACK/FAILURE_STREAK/FORCED_CLOSURE guardrail,
// runFallbackSummary, runFailureStreakSummary, runForcedClosureSummary, PENDING_MARKER_HINT.

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
  // turnStartTime: ISO 形式的 loop 起始时刻,供 ledger 按 turn 划界
  // (loopStart 是 Date.now() 的数字,无法直接给 SQL 比较 ISO 时间戳)
  const turnStartTime = new Date(loopStart).toISOString()
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
    streamOptions: opts.streamOptions,
    turnStartTime,
  }

  const accumulator = new LoopAccumulator()
  const mcpState = new McpExposureState(opts.agent)

  // Detector 顺序敏感 (业务属性, 显式排列):
  //   L1 流程健康度 (硬阻断 / forced summary,**维度 A 系统职责**):
  //     1. signature-dead-loop:  原地重试同一调用 (最敏感, 阈值 1/2)
  //     2. failure-streak:       连续 N 次工具失败 (兜底 signature 没抓到的"换参全败")
  //     3. tool-only-loop:       连续 N 步工具调用但零文本 (signature 抓不到的变种)
  //
  // v3.7 移除: no-marker-streak + forced-closure (把"无 marker"当 bug 反而引发自答灾难)
  // v3.7.1 移除: wait-and-act-conflict + hallucinated-confirm
  //   —— 用 regex 做语义判断属于"系统抢 LLM 活"反模式,不强制只软建议,两边不靠岸。
  //   真危险路径仍由 RiskGate 拦,删除二者不丢失安全。
  //   见 docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md
  const detectors: import('./detectors/types').LoopDetector[] = [
    new SignatureDeadLoopDetector(ctx),
    new FailureStreakDetector(ctx),
    new ToolOnlyLoopDetector(),
  ]

  let exitReason: LoopExitReason = 'no_tool_calls'

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }

    const hint = composeHint(detectors)
    const { expand, used } = mcpState.flags
    const outcome = await runReactStep(ctx, step, maxSteps, expand, used, hint)

    mcpState.update(outcome)
    accumulator.observe(outcome)

    const facts = classify(outcome)

    // Detector 顺序遍历 — 第一个 triggered 即 break。
    // raw 仅 SemanticDetector 用 (旧 L1 detector 忽略此参数, 接口向后兼容)。
    const rawCtx = { stepText: outcome.stepText }
    let detectorBroke = false
    for (const detector of detectors) {
      const verdict = detector.observe(facts, accumulator.totalSteps, rawCtx)
      if (!verdict.triggered) continue
      log.warn(`[ReactLoop] Detector "${detector.name}" triggered (exit=${verdict.exitReason})`)
      if (verdict.runSummary) await verdict.runSummary()
      if (verdict.markFinal) accumulator.markFinal()
      exitReason = verdict.exitReason ?? exitReason
      detectorBroke = true
      break
    }
    if (detectorBroke) break

    if (!outcome.shouldContinue) {
      exitReason = outcome.exitReason ?? 'no_tool_calls'
      break
    }
    if (step === maxSteps - 1) {
      exitReason = 'max_steps'
    }
  }

  // 兜底摘要:整轮零文本且未写过 final → 强制一次无工具 streamText 让用户至少看到一条消息。
  // 非 abort 才触发 (用户主动停止时不兜底)。
  if (accumulator.needsFallback() && exitReason !== 'abort') {
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
