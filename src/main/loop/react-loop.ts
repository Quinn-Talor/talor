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
import { verifyQuotedFacts } from './quote-verifier'
import { buildTools } from '../tools/build-tools'
import { estimate } from '../memory/types'
import type { ReactLoopOptions, ReactLoopCallbacks } from './types'
import type { ContentBlock } from '@shared/types/message'
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
}

/** 循环终止原因枚举。写入终局日志，方便排查为什么停下来。 */
type LoopExitReason =
  | 'no_tool_calls'       // 模型不再调用工具（正常终态）
  | 'empty_text'          // 模型既无工具调用也无文本（触发兜底）
  | 'abort'               // 调用方主动中止
  | 'max_steps'           // 达到步数上限
  | 'fallback_summary'    // 兜底摘要触发
  | 'repeated_error'      // 死循环保护（签名重复 或 错误率超阈值）
  | 'context_overflow'    // prompt 估算已 >= context_limit,提交前短路

function sha8(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8)
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
  const entries = Object.entries(v as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
  return '{' + entries.map(([k, val]) => JSON.stringify(k) + ':' + canonicalizeJson(val)).join(',') + '}'
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
      log.error(`[ReactLoop]   context overflow: ${estimatedTokens}/${limit} (${(usageRatio * 100).toFixed(1)}%). Halting before submission.`)
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
      ctx.callbacks.onTextDelta(haltText)
      return {
        stepText: haltText,
        wroteAssistantFinal: true,
        shouldContinue: false,
        durationMs: Date.now() - stepStart,
        toolNames: [],
        exitReason: 'context_overflow',
        signature: '',
        allToolsFailed: null,
      }
    }

    if (usageRatio > CONTEXT_USAGE_WARNING_RATIO) {
      log.warn(`[ReactLoop]   context near overflow: ${estimatedTokens}/${limit} (${(usageRatio * 100).toFixed(1)}%)`)
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
        return { stepText, wroteAssistantFinal: true, shouldContinue: false, durationMs, toolNames, exitReason: 'no_tool_calls', signature: '', allToolsFailed: null }
      }
      log.info(`[ReactLoop]   → empty (no text, no tools) [${durationMs}ms]`)
      persisted = true   // 无东西可持久化，finally 不需兜底
      return { stepText: '', wroteAssistantFinal: false, shouldContinue: false, durationMs, toolNames, exitReason: 'empty_text', signature: '', allToolsFailed: null }
    }

    // 有工具调用 → 落库 assistant + tool,继续下一步
    let toolResults: Awaited<typeof result.toolResults> = await result.toolResults
    if (toolResults.length === 0) {
      // toolResults 空有两类原因:
      //   a) 工具名根本不在 registry(模型编造了工具名)
      //   b) 工具存在但执行路径失败(MCP 崩溃/SDK 解析失败/超时)
      // 两者回传给模型的指示截然不同:前者可以改名重试,后者必须停手。
      const registeredNames = ctx.agent.toolRegistry.getToolNames()
      toolResults = stepToolCalls.map(tc => ({
        type: 'tool-result' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
        output: registeredNames.includes(tc.toolName)
          ? `Tool execution failed: "${tc.toolName}" was invoked but returned no result ` +
            `(likely transport error, timeout, or MCP server crash). ` +
            `Retrying with the same parameters is unlikely to help — try a different approach, ` +
            `adjust the parameters, or fall back to another tool.`
          : `Tool not found: "${tc.toolName}". Available tools: ${registeredNames.join(', ')}`,
        dynamic: true as const,
      })) as typeof toolResults
      log.warn(`[ReactLoop]   → toolResults empty, injected differentiated feedback [${durationMs}ms]`)
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
    const allToolsFailed = toolBlocks.length > 0 && toolBlocks.every(
      b => b.type === 'tool_result' && b.isError === true,
    )
    return { stepText, wroteAssistantFinal: false, shouldContinue: true, durationMs, toolNames, signature, allToolsFailed }
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
      // 代码前置约束:摘要靠 prompt 指示"逐字引用",但无法保证模型不编造。
      // 这里把最近 10 条 tool_output 当证据集,扫描摘要里所有 >= 20 字节的
      // "..." / `...` 引用,未命中的替换为 ⟨unverifiable⟩——让用户一眼看到
      // 被 AI 编造的片段,而不是按引号相信却查不到出处。
      const toolOutputs = collectRecentToolOutputs(ctx.sessionId, 10)
      const { cleaned, unverifiedCount } = verifyQuotedFacts(summaryText, toolOutputs)
      if (unverifiedCount > 0) {
        log.warn(`[ReactLoop]   fallback: masked ${unverifiedCount} unverifiable quote(s)`)
      }
      const label = unverifiedCount > 0
        ? `[auto-summary • ${unverifiedCount} unverifiable quote${unverifiedCount > 1 ? 's' : ''} masked]`
        : '[auto-summary]'
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
  let lastStepSignature = ''
  let consecutiveRepeatCount = 0
  let consecutiveFailureCount = 0

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
      const isErrorSig = outcome.allToolsFailed === true
      const threshold = isErrorSig
        ? REPEATED_SIGNATURE_THRESHOLD_WITH_ERROR
        : REPEATED_SIGNATURE_THRESHOLD_NO_ERROR
      if (outcome.signature === lastStepSignature) {
        consecutiveRepeatCount++
        if (consecutiveRepeatCount >= threshold) {
          log.warn(`[ReactLoop] Dead loop: signature "${outcome.signature}" repeated ${consecutiveRepeatCount + 1}x (isError=${isErrorSig}). Breaking.`)
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
      consecutiveFailureCount++
      if (consecutiveFailureCount >= CONSECUTIVE_FAILURE_LIMIT) {
        log.warn(`[ReactLoop] Failure streak: ${consecutiveFailureCount} consecutive steps all failed. Breaking.`)
        messageRepo.create({
          id: uuidv4(),
          session_id: ctx.sessionId,
          role: 'assistant',
          content: [{
            type: 'text',
            text: `[auto-halt] Task blocked by ${consecutiveFailureCount} consecutive tool failures. Please review the errors above and provide guidance.`,
          }],
          agent_id: ctx.agentId,
        })
        sessionRepo.touch(ctx.sessionId)
        wroteAssistantFinal = true
        exitReason = 'repeated_error'
        break
      }
    } else if (outcome.allToolsFailed === false) {
      // 至少一个工具成功 → 清零连续失败计数。
      // null(无工具调用)不 reset,保守。
      consecutiveFailureCount = 0
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
