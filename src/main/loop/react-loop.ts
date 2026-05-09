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

import {
  streamText,
  type LanguageModel,
  type ModelMessage,
  type AssistantContent,
  type ToolContent,
} from 'ai'
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
import { verifyQuotedFacts, verifyEntityGrounding } from './quote-verifier'
import { buildTools } from '../tools/build-tools'
import { estimate } from '../memory/types'
import type { ReactLoopOptions, ReactLoopCallbacks } from './types'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'

/**
 * 单步 prompt 估算到达该比例时,提醒模型收敛。
 * ShortTermMemory 90% 触发压缩后,已压缩过的 prompt 再次超此阈值意味着
 * 纯粹的工具输出/recent 段已经吃满窗口,继续跑可能被 provider 静默截断。
 *
 * 阈值设在 98%(而非 95%):estimate() 是偏保守的 token 估算,90%~95% 实际
 * 还有充足余量;只有估算超 98% 才算真的"临门一脚"。告警文本也避免命令模型
 * "不许再开工具链"——长 prompt 本身不等于任务该被放弃,只提醒"尽量收敛"。
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
}

/** runReactStep 返回值——循环控制层据此决定是否继续。 */
interface StepOutcome {
  /** 本步产生的纯文本（供兜底判断 fullText 是否为空） */
  stepText: string
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
  /**
   * 本步是否"所有工具调用都失败"。
   * - null: 本步无工具调用，不参与错误率统计
   * - true: 本步有工具调用且每一条 tool_result.isError 都为 true
   * - false: 至少一条工具调用成功
   * 顶层用滑窗统计连续错误率,阻止"模型换参数重试→依然失败"的隐式死循环。
   */
  allToolsFailed: boolean | null
  /**
   * 本步是否含至少一个 delegate_agent 返回的 SUBAGENT_* envelope。
   * 委托失败比普通工具失败成本高（消耗了一整个子 loop）, 顶层在 streak 计数器
   * 上加权（+2 而非 +1）, 让父 loop 更早进入 failure-recovery 模式。
   */
  containsSubagentFailure: boolean
}

/** 循环终止原因枚举。写入终局日志，方便排查为什么停下来。 */
type LoopExitReason =
  | 'no_tool_calls' // 模型不再调用工具（正常终态）
  | 'empty_text' // 模型既无工具调用也无文本（触发兜底）
  | 'abort' // 调用方主动中止
  | 'max_steps' // 达到步数上限
  | 'fallback_summary' // 兜底摘要触发
  | 'repeated_error' // 死循环保护（签名重复 或 错误率超阈值）
  | 'tool_only_loop' // 连续 N 步有工具调用但零文本输出
  | 'context_overflow' // prompt 估算已 >= context_limit,提交前短路

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

/**
 * C3: 清洗 fallback / failure-recovery 输出中泄漏的工具调用 markup。
 * Failure-recovery 模式下工具被禁用,但模型仍可能把 tool_use 风格 markup 当文本输出
 * (DSML / invoke / parameter / tool_calls)。直接显示给用户混乱。
 *
 * 替换策略:把符合常见 tool-call 模式的标签替换为 ⟨tool-call-attempt⟩ 占位,
 * 不直接删除以保留"曾尝试调工具"的事实信号。
 */
function stripToolCallMarkup(text: string): string {
  if (!text) return text
  // 先把 || 风格的 DSML 分隔符标签替换 (如 <||DSML||tool_calls> 等)
  let out = text.replace(/<\|\|[^>]*>/g, '⟨tool-call-attempt⟩')
  // 再把常见 tool_use XML 标签 (含可选属性 / 闭合斜杠)
  out = out.replace(/<\/?(?:invoke|parameter|tool_call|tool_calls|tool_use)\b[^>]*>/gi, '')
  // 连续多个占位符合并为一个,降低噪声
  out = out.replace(/(?:⟨tool-call-attempt⟩\s*){2,}/g, '⟨tool-call-attempt⟩ ')
  return out
}

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
  let stepText = ''
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

    // 无工具调用 → 本次推理结束（正常终态）
    if (stepToolCalls.length === 0) {
      if (stepText) {
        log.info(`[ReactLoop]   → text: ${stepText.length} chars (no tools) [${durationMs}ms]`)
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
        log.info(`[ReactLoop]   partial aborted step persisted (${abortedParts.length} parts)`)
      } catch (persistErr) {
        log.error('[ReactLoop]   failed to persist partial aborted step:', persistErr)
      }
    }
  }
}

/**
 * 收集最近 k 条 tool 角色消息的 raw output 文本,供 verifyQuotedFacts 比对。
 *
 * 为什么从后往前扫:兜底摘要最相关的证据是"刚刚跑过的工具",越早的越次要;
 * 取 k 条后就停,避免对已存档的历史 session 做全量读取。
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
      // 非 blocks 格式的旧消息,跳过
    }
  }
  return outputs
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

/**
 * 失败连击降级摘要。streak >= 3 时调用，替代旧的 "[auto-halt]" 硬中断。
 *
 * 行为：禁用 tools 再做一次 streamText，强制模型用文本向用户说明：
 *   - 它尝试了什么
 *   - 失败的具体错误
 *   - 用户可能的后续动作
 *
 * 与 runFallbackSummary 的区别：触发时机不同（这是失败链触发，不是空文本触发），
 * 但底层流程几乎一致——共享落库、verifyQuotedFacts、token-stream 回调。
 */
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

async function runFailureStreakSummary(
  ctx: StepContext,
  stepIndex: number,
  failureCount: number,
): Promise<void> {
  log.info(`[ReactLoop] ${SEPARATOR} failure-streak summary (count=${failureCount}) ${SEPARATOR}`)
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
      messages: [...messages, FAILURE_STREAK_GUARDRAIL],
      abortSignal: buildStreamSignal(ctx.abortSignal),
    })
    let summaryText = ''
    for await (const chunk of summaryResult.textStream) {
      summaryText += chunk
      ctx.callbacks.onTextDelta(chunk, stepIndex)
    }
    const durationMs = Date.now() - summaryStart
    const baseText =
      summaryText.trim() ||
      `I was unable to complete the task after ${failureCount} consecutive tool failures. Please advise.`
    const toolOutputs = collectRecentToolOutputs(ctx.sessionId, 10)
    // 1) verifyQuotedFacts: 长引用兜底
    const { cleaned: q1, unverifiedCount } = verifyQuotedFacts(baseText, toolOutputs)
    // 2) C2 entity grounding: 实体接地兜底
    const { cleaned: q2, ungroundedCount } = verifyEntityGrounding(q1, {
      instruction: ctx.userContent,
      toolOutputs,
    })
    // 3) C3 strip tool-call markup: 清掉模型在 tool 禁用模式下泄漏的 DSML / invoke 标签
    const cleaned = stripToolCallMarkup(q2)

    if (unverifiedCount > 0) {
      log.warn(`[ReactLoop]   failure-streak: masked ${unverifiedCount} unverifiable quote(s)`)
    }
    if (ungroundedCount > 0) {
      log.warn(
        `[ReactLoop]   failure-streak: masked ${ungroundedCount} ungrounded entity reference(s)`,
      )
    }
    const labelTags: string[] = []
    if (unverifiedCount > 0)
      labelTags.push(
        `${unverifiedCount} unverifiable quote${unverifiedCount > 1 ? 's' : ''} masked`,
      )
    if (ungroundedCount > 0)
      labelTags.push(
        `${ungroundedCount} ungrounded entit${ungroundedCount > 1 ? 'ies' : 'y'} masked`,
      )
    const label =
      labelTags.length > 0 ? `[failure-recovery • ${labelTags.join('; ')}]` : '[failure-recovery]'
    const markedText = `${label}\n${cleaned}`
    messageRepo.create({
      id: uuidv4(),
      session_id: ctx.sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: markedText }],
      agent_id: ctx.agentId,
    })
    sessionRepo.touch(ctx.sessionId)
    log.info(`[ReactLoop]   → failure-streak summary: ${baseText.length} chars [${durationMs}ms]`)
  } catch (err) {
    log.error(
      `[ReactLoop]   → failure-streak summary failed [${Date.now() - summaryStart}ms]:`,
      err,
    )
    // 兜底兜底——summary 自身失败时回退到原来的 [auto-halt] 行为，保证至少
    // 用户看到一条消息而不是静默退出。
    messageRepo.create({
      id: uuidv4(),
      session_id: ctx.sessionId,
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: `[auto-halt] Task blocked by ${failureCount} consecutive tool failures. Please review the errors above and provide guidance.`,
        },
      ],
      agent_id: ctx.agentId,
    })
    sessionRepo.touch(ctx.sessionId)
  }
}

async function runFallbackSummary(ctx: StepContext, stepIndex: number): Promise<void> {
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
      ctx.callbacks.onTextDelta(chunk, stepIndex)
    }
    const durationMs = Date.now() - summaryStart
    if (summaryText.trim()) {
      // 代码前置约束:摘要靠 prompt 指示"逐字引用",但无法保证模型不编造。
      // 三层兜底叠加（同 runFailureStreakSummary）:
      //   1) verifyQuotedFacts: 长引用核对
      //   2) verifyEntityGrounding: 高置信度实体必须接地于 instruction/tool_output
      //   3) stripToolCallMarkup: 清掉模型在 tool 禁用模式下泄漏的工具调用 markup
      const toolOutputs = collectRecentToolOutputs(ctx.sessionId, 10)
      const { cleaned: q1, unverifiedCount } = verifyQuotedFacts(summaryText, toolOutputs)
      const { cleaned: q2, ungroundedCount } = verifyEntityGrounding(q1, {
        instruction: ctx.userContent,
        toolOutputs,
      })
      const cleaned = stripToolCallMarkup(q2)

      if (unverifiedCount > 0) {
        log.warn(`[ReactLoop]   fallback: masked ${unverifiedCount} unverifiable quote(s)`)
      }
      if (ungroundedCount > 0) {
        log.warn(`[ReactLoop]   fallback: masked ${ungroundedCount} ungrounded entity reference(s)`)
      }
      const labelTags: string[] = []
      if (unverifiedCount > 0)
        labelTags.push(
          `${unverifiedCount} unverifiable quote${unverifiedCount > 1 ? 's' : ''} masked`,
        )
      if (ungroundedCount > 0)
        labelTags.push(
          `${ungroundedCount} ungrounded entit${ungroundedCount > 1 ? 'ies' : 'y'} masked`,
        )
      const label =
        labelTags.length > 0 ? `[auto-summary • ${labelTags.join('; ')}]` : '[auto-summary]'
      const markedText = `${label}\n${cleaned}`
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
  // Schema 1.0: profile.execution.limits.maxSteps override 默认/opts
  const profileLimits = opts.agent?.profile?.execution?.limits as { maxSteps?: number } | undefined
  const maxSteps =
    opts.maxSteps ??
    (profileLimits && typeof profileLimits.maxSteps === 'number'
      ? profileLimits.maxSteps
      : DEFAULT_MAX_STEPS)

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
  }

  let fullText = ''
  let wroteAssistantFinal = false
  let totalSteps = 0
  let totalToolCalls = 0
  let exitReason: LoopExitReason = 'no_tool_calls'
  const allToolNames: string[] = []

  // Dead-loop detection.
  //
  // 两路侦测,都按"保守触发"设计——宁可漏报一次也不打断合法的自我修正:
  //   1) 签名重复 (stepSignature: toolName + inputHash + outputHash)
  //      - 带 error 输出:阈值 1(连续第 2 次同错 = 真死循环,模型显然没在读错误)
  //      - 不带 error:  阈值 2(连续第 3 次同调用才 break,允许合理的幂等读)
  //   2) 连续失败连击
  //      "N 步连续 allToolsFailed=true" 才 break。任意一步有工具调用成功 → 清零。
  //      这是 signature 侦测之外的兜底。设计分工:
  //        - signature with error (阈值 1):锁"原地重试同一调用"
  //        - Failure streak   (阈值 3):兜底"每次换参数但全失败"
  //      阈值 3 给模型充分的"修错误→遇到新错误→告知用户"链条。阈值 2 会误伤
  //      正在真实修正 flag 的模型(step 2 改 flag → step 3 撞 missing_scope → break
  //      就不让模型走到 step 4 输出"请用户授权"的文本)。
  const REPEATED_SIGNATURE_THRESHOLD_WITH_ERROR = 1
  const REPEATED_SIGNATURE_THRESHOLD_NO_ERROR = 2
  const CONSECUTIVE_FAILURE_LIMIT = 3
  const TOOL_ONLY_STEP_LIMIT = 8
  let lastStepSignature = ''
  let consecutiveRepeatCount = 0
  let consecutiveFailureCount = 0
  let consecutiveToolOnlySteps = 0
  // 累积可见策略（方案 C）：
  //   - mcpExpandThisStep: 一次性"全集"展示——
  //       · turn 第一步默认 true（若已连接任何 MCP server），让模型直接看到
  //         全部 MCP 工具，省掉 "search_tool → 下一步" 的强制双跳。
  //       · 之后默认 false；如果某步调过 search_tool，下一步再置 true。
  //   - usedMcpToolNames:  累积已使用过的 MCP 工具名（本轮内只增不减）
  // 平衡 token 开销（不暴露未用过的 MCP schema）与上下文稳定（已用过的工具
  // 一直可见，避免反复 search 浪费）。
  let mcpExpandThisStep = (ctx.agent.toolRegistry?.listMcpTools?.().length ?? 0) > 0
  const usedMcpToolNames = new Set<string>()
  // 缓存 MCP 工具名集合用于判断 outcome.toolNames 中哪些是 MCP（仅在首次需要时取）
  let mcpNameSet: Set<string> | null = null

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }
    // Strategy A — 渐进式失败提示：streak 累积到阈值-1 时（即下一次失败就 break），
    // 注入一条 system 消息让模型自我修正：换思路、换工具、或求助用户。
    const failureHintMessage =
      consecutiveFailureCount === CONSECUTIVE_FAILURE_LIMIT - 1
        ? `[failure-streak warning] Your previous ${consecutiveFailureCount} tool calls all returned errors. ` +
          `One more failure and tool execution will stop for this turn. ` +
          `Reconsider before your next action: try a different tool or different parameters, ` +
          `verify your assumptions (paths exist? syntax correct?), or summarize what you've tried ` +
          `and ask the user for guidance. Do NOT repeat the same approach.`
        : null

    const outcome = await runReactStep(
      ctx,
      step,
      maxSteps,
      mcpExpandThisStep,
      Array.from(usedMcpToolNames),
      failureHintMessage,
    )
    // 默认下一步不再扩展；search_tool 调用会再次置 true
    let nextExpand = false
    if (outcome.toolNames.length > 0) {
      if (!mcpNameSet) {
        mcpNameSet = new Set(ctx.agent.toolRegistry.listMcpTools().map((t) => t.name))
      }
      for (const tn of outcome.toolNames) {
        if (tn === 'search_tool') {
          nextExpand = true
        } else if (mcpNameSet.has(tn)) {
          usedMcpToolNames.add(tn)
        }
      }
    }
    mcpExpandThisStep = nextExpand
    totalSteps++
    fullText += outcome.stepText
    totalToolCalls += outcome.toolNames.length
    allToolNames.push(...outcome.toolNames)
    if (outcome.wroteAssistantFinal) wroteAssistantFinal = true

    if (outcome.signature) {
      const isErrorSig = outcome.allToolsFailed === true
      const threshold = isErrorSig
        ? REPEATED_SIGNATURE_THRESHOLD_WITH_ERROR
        : REPEATED_SIGNATURE_THRESHOLD_NO_ERROR
      if (outcome.signature === lastStepSignature) {
        consecutiveRepeatCount++
        if (consecutiveRepeatCount >= threshold) {
          log.warn(
            `[ReactLoop] Dead loop: signature "${outcome.signature}" repeated ${consecutiveRepeatCount + 1}x (isError=${isErrorSig}). Breaking.`,
          )
          exitReason = 'repeated_error'
          break
        }
      } else {
        lastStepSignature = outcome.signature
        consecutiveRepeatCount = 0
      }
    }
    // 无工具调用的步(纯文本 / empty)不参与签名判定,也不 reset——
    // 避免模型在死循环中穿插一步纯思考就逃脱侦测。

    if (outcome.allToolsFailed === true) {
      // E1: SUBAGENT_*/DELEGATION_* failure 加权 +2,普通 tool 失败 +1。
      // 子 loop 已经烧掉一整轮推理,代价更高,触发 failure-recovery 应该更早。
      const weight = outcome.containsSubagentFailure ? 2 : 1
      consecutiveFailureCount += weight
      if (outcome.containsSubagentFailure) {
        log.warn(
          `[ReactLoop] SUBAGENT_* failure detected, streak +2 (now ${consecutiveFailureCount})`,
        )
      }
      if (consecutiveFailureCount >= CONSECUTIVE_FAILURE_LIMIT) {
        // Strategy B — 优雅退出：到达失败链阈值时不立即 halt，而是禁用工具、
        // 强制模型用文本向用户解释发生了什么。比"[auto-halt]"冷消息友好得多。
        log.warn(
          `[ReactLoop] Failure streak: ${consecutiveFailureCount} consecutive steps all failed. Switching to text-only recovery summary.`,
        )
        await runFailureStreakSummary(ctx, totalSteps, consecutiveFailureCount)
        wroteAssistantFinal = true
        exitReason = 'repeated_error'
        break
      }
    } else if (outcome.allToolsFailed === false) {
      // 至少一个工具成功 → 清零连续失败计数。
      // null(无工具调用)不 reset,保守。
      consecutiveFailureCount = 0
    }

    // Tool-only loop detection: model keeps calling tools but never outputs text.
    // Signature-based detection won't catch this when inputs differ each step.
    if (outcome.toolNames.length > 0 && outcome.stepText.trim() === '') {
      consecutiveToolOnlySteps++
      if (consecutiveToolOnlySteps >= TOOL_ONLY_STEP_LIMIT) {
        log.warn(
          `[ReactLoop] Tool-only loop: ${consecutiveToolOnlySteps} consecutive steps with tools but no text. Breaking.`,
        )
        exitReason = 'tool_only_loop'
        break
      }
    } else if (outcome.stepText.trim() !== '') {
      consecutiveToolOnlySteps = 0
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
    await runFallbackSummary(ctx, totalSteps)
  }

  // 循环结束报告
  const totalMs = Date.now() - loopStart
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
  log.info(
    `[ReactLoop] done | steps: ${totalSteps} | total: ${(totalMs / 1000).toFixed(1)}s | exit: ${exitReason}`,
  )
  log.info(
    `[ReactLoop]      | text: ${fullText.length} chars | tools: ${totalToolCalls} calls [${[...new Set(allToolNames)].join(', ') || 'none'}]`,
  )
  log.info(`[ReactLoop] ${DOUBLE_SEPARATOR}`)
}
