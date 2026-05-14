// src/main/agent/delegate-agent.ts — 业务层：delegate_agent 内置 Tool
//
// 委托子 Agent 执行任务。创建子 session，在子 Agent 的 runtime 下独立跑一轮
// ReAct loop，把最终 assistant text 作为 tool_result 回给父 Agent。
//
// 关键不变量：
//   1. execute() 全包 try/catch，永不让异常炸穿父 react-loop（保 §I-MUST-1
//      配对不变量；patterns §P6）
//   2. 子 Agent 结构上不持有 delegate_agent 工具（业务 agent 永不接收
//      DelegationRuntime + 平台 worker agent 的 profile.disabledTools 含
//      'delegate_agent'）—— 防递归不靠运行时 envelope，靠工具不可见
//   3. 同 session 并发上限 K：用 p-limit 库实现，不要手写 counter（race-prone）
//   4. AbortController 链 + setTimeout(.unref()) + finally clearTimeout 三件套
//      防止用户 stop 后子 loop 跑不停 / 进程退不掉
//
// 委托质量保护层（v2，本次新增）：
//   A1 capability listing — buildDescription 暴露 tools/mcp/scope metadata
//   A2 instruction-scope check — 入口前置兼容性校验
//   A3 per-agent budget — 同 session 同 agent_id 调用上限
//   B1 auto-context — 自动注入父最近 user message + tool errors
//   B2 entity binding — 子 agent 输出必须提及 instruction 实体之一
//   C1 recovery envelope — failure-recovery 文本转结构化错误
//
// 允许依赖：agent/* / repos/* / chat/events / loop/* / skills/* / prompt/* / shared/*
// 禁止依赖：ipc/*

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import pLimit from 'p-limit'
import type { LimitFunction } from 'p-limit'
import { z } from 'zod'

import type { ToolDefinition, ToolErrorEnvelope, ToolExecuteContext } from '../tools/types'
import type { AgentManager } from './agent-manager'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import { messageRepo } from '../repos/session-repo'
import type { ChatMessage, sessionRepo as SessionRepoT } from '../repos/session-repo'
import { ExecutionEventBus } from '../chat/events'
import { SkillActivationTracker } from '../skills/registry'

import type { LanguageModel } from 'ai'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'

// ─── 公共类型 ─────────────────────────────────────────────────────────

export interface DelegationConfig {
  /** 同 session 并发上限（K）。默认 10。 */
  maxConcurrencyPerSession: number
  /** 排队超时（ms）。默认 5min。 */
  queueTimeoutMs: number
  /** 单次委托执行超时（ms）。默认 30min。 */
  executionTimeoutMs: number
  /** A3: 同 session 同 agent_id 委托总次数上限。默认 3。 */
  maxInvocationsPerAgentPerSession: number
}

export interface ProviderContext {
  model: LanguageModel
  provider: Provider
  providerConfig: ProviderContextConfig
  streamOptions?: Record<string, unknown>
}

/** 子 ReAct loop 入口签名（和 loop/react-loop.ts 的 runReactLoop 兼容）。 */
export type RunReactLoopFn = (opts: import('../loop/types').ReactLoopOptions) => Promise<void>

export interface DelegationRuntime {
  agentManager: AgentManager
  runReactLoop: RunReactLoopFn
  sessionRepo: typeof SessionRepoT
  pipeline: PromptPipeline
  config: DelegationConfig
  /** 由 parentSessionId 解析子 loop 用的 provider/model（继承父的 provider/model 配置）。 */
  providerContextProvider: (parentSessionId: string) => ProviderContext
}

// ─── 内部 per-session limiter 表 ──────────────────────────────────────

const limiterPerSession = new Map<string, LimitFunction>()

function getLimiter(sessionId: string, K: number): LimitFunction {
  let l = limiterPerSession.get(sessionId)
  if (!l) {
    l = pLimit(K)
    limiterPerSession.set(sessionId, l)
  }
  return l
}

/** A3: per-session × per-agent 调用计数（仅本进程内存,session 关闭即清理）。 */
const invocationCounts = new Map<string, Map<string, number>>()
function bumpInvocation(sessionId: string, agentId: string): number {
  let inner = invocationCounts.get(sessionId)
  if (!inner) {
    inner = new Map()
    invocationCounts.set(sessionId, inner)
  }
  const next = (inner.get(agentId) ?? 0) + 1
  inner.set(agentId, next)
  return next
}

/** Session 删除路径调用，防止 limiter Map / invocation Map 泄漏。 */
export function clearLimiter(sessionId: string): void {
  limiterPerSession.delete(sessionId)
  invocationCounts.delete(sessionId)
}

// 仅供测试访问
export const __TEST__ = { limiterPerSession, invocationCounts }

// ─── 错误信封 ─────────────────────────────────────────────────────────

const HINTS: Record<string, string> = {
  AGENT_NOT_FOUND:
    'Confirm the agent_id matches a registered business agent. Use lowercase, no spaces.',
  DELEGATION_QUEUE_TIMEOUT:
    'Too many concurrent delegations in this session. Wait for some to finish, then try again.',
  SUBAGENT_TIMEOUT:
    'Subagent exceeded executionTimeoutMs. The task may be too large; split it into smaller pieces.',
  SUBAGENT_ABORTED:
    'Subagent was aborted (parent stopped or upstream cancellation). No partial result available.',
  SUBAGENT_FAILED: 'Subagent threw an unexpected exception. Check application logs for details.',
  SUBAGENT_MCP_INIT_FAILED:
    'Subagent profile depends on an MCP server that failed to start. Check MCP server config.',
  SUBAGENT_MAX_STEPS:
    'Subagent reached maxSteps without producing a final answer. Increase maxSteps or simplify the task.',
  // v3.7.2: INSTRUCTION_OUT_OF_SCOPE / SUBAGENT_OFF_TARGET 已删除 (A2/B2 移除)。
  DELEGATION_BUDGET_EXHAUSTED:
    'This subagent has already been invoked the maximum number of times in this session. Try a different approach or agent.',
  SUBAGENT_RECOVERY:
    'Subagent entered failure-recovery mode (3+ consecutive tool failures). Treat as failure; investigate sub-session for details.',
}

function makeEnvelope(
  code: string,
  extra?: { message?: string; hint?: string; [k: string]: unknown },
): ToolErrorEnvelope & Record<string, unknown> {
  return {
    __talor_error: true,
    code,
    message: extra?.message ?? `[${code}]`,
    hint: extra?.hint ?? HINTS[code] ?? '',
    ...extra,
  }
}

// ─── Zod schema ───────────────────────────────────────────────────────

const DelegateInput = z.object({
  agent_id: z
    .string()
    .min(1)
    .describe('Target subagent ID (must be a registered business agent or platform agent).'),
  instruction: z
    .string()
    .min(1)
    .describe('What you want the subagent to do — be specific and actionable.'),
  context: z
    .string()
    .optional()
    .describe(
      'Background information the subagent needs to complete the task. ' +
        'The subagent CANNOT see this conversation — provide all necessary context here.',
    ),
})
type DelegateInputT = z.infer<typeof DelegateInput>

// ─── 私有错误类（用于 cause 分类） ────────────────────────────────────

class QueueTimeoutError extends Error {
  constructor() {
    super('queue_timeout')
    this.name = 'QueueTimeoutError'
  }
}

// ─── 工厂函数 ─────────────────────────────────────────────────────────

export interface CreateDelegateToolOpts {
  runtime: DelegationRuntime
  /**
   * 委托 scope：
   *   - null:    全开放（可委托任何已注册业务 agent）—— 仅 __chat__ 等通用 orchestrator 使用
   *   - string[]: 显式 allow list（仅可委托列表内 agent_id）—— 业务 agent 声明 subagents 时用
   *   - []:      空 scope（持有工具但无可委托目标）—— 默认业务 agent / __crystallizer__
   */
  allowedAgentIds: string[] | null
}

export function createDelegateAgentTool(
  optsOrRuntime: CreateDelegateToolOpts | DelegationRuntime,
): ToolDefinition {
  // 兼容老签名 createDelegateAgentTool(runtime)：等价于 allowedAgentIds=null（全开放）
  const opts: CreateDelegateToolOpts =
    'allowedAgentIds' in optsOrRuntime
      ? (optsOrRuntime as CreateDelegateToolOpts)
      : { runtime: optsOrRuntime as DelegationRuntime, allowedAgentIds: null }
  const { runtime, allowedAgentIds } = opts

  return {
    name: 'delegate_agent',
    description: buildDescription(runtime.agentManager, allowedAgentIds),
    parameters: z.toJSONSchema(DelegateInput) as Record<string, unknown>,
    riskLevel: 'LOW',
    zodSchema: DelegateInput,

    execute: async (input: unknown, ctx: ToolExecuteContext) => {
      const params = input as DelegateInputT // Zod 已校验
      const { agent_id, instruction, context } = params

      // ─ Step 1a: scope 校验（先于 agent 查找，让 hint 准确列出 allowed）─
      if (allowedAgentIds !== null && !allowedAgentIds.includes(agent_id)) {
        log.info(
          `[DelegateAgent] scope rejected: agent_id=${agent_id} allowed=[${allowedAgentIds.join(',')}]`,
        )
        return {
          output: makeEnvelope('AGENT_NOT_FOUND', {
            message: `Agent "${agent_id}" is not in this agent's subagent dependencies.`,
            hint:
              allowedAgentIds.length > 0
                ? `Allowed: ${allowedAgentIds.join(', ')}`
                : 'This agent has no subagent dependencies declared; delegation is not possible from here.',
          }),
        }
      }

      // ─ Step 1b: agent 查找 ─
      const agent = runtime.agentManager.getAgent(agent_id)
      if (!agent) {
        return {
          output: makeEnvelope('AGENT_NOT_FOUND', {
            message: `Agent "${agent_id}" not found.`,
          }),
        }
      }

      // ─ Step 1c (A3): per-agent budget 检查 ─
      // 注意:在实际 launch 之前 bump,即"尝试委托即计数"。budget 用尽即拒绝,
      // 避免父 agent 在子失败后无脑重试同一 agent_id。
      const budgetMax = runtime.config.maxInvocationsPerAgentPerSession
      const used = bumpInvocation(ctx.sessionId, agent_id)
      if (used > budgetMax) {
        log.info(
          `[DelegateAgent] budget exhausted: session=${ctx.sessionId} agent=${agent_id} used=${used} max=${budgetMax}`,
        )
        return {
          output: makeEnvelope('DELEGATION_BUDGET_EXHAUSTED', {
            message: `Agent "${agent_id}" has been delegated ${used - 1} times in this session (max ${budgetMax}).`,
            agent_id,
            invocations_used: used - 1,
            budget_max: budgetMax,
          }),
        }
      }

      // v3.7.2: A2 instruction-scope check 已删除 —— regex 实体匹配做语义判断是
      // "系统抢 LLM 活"反模式 (见 J-SHOULD-2)。父 agent 通过 A1 capability listing
      // 自行判断该委托给哪个 agent;capability 不匹配时父 agent (LLM) 会自然不选。

      // ─ Step 2: limiter + 排队超时 race ─
      const limit = getLimiter(ctx.sessionId, runtime.config.maxConcurrencyPerSession)
      const queueLen = limit.pendingCount
      if (queueLen > 0) {
        log.info(
          `[DelegateAgent] queued sessionId=${ctx.sessionId} pending=${queueLen} active=${limit.activeCount}`,
        )
      }

      let queueTimer: NodeJS.Timeout | undefined
      const queueTimeoutPromise = new Promise<never>((_, reject) => {
        queueTimer = setTimeout(
          () => reject(new QueueTimeoutError()),
          runtime.config.queueTimeoutMs,
        )
        if (queueTimer.unref) queueTimer.unref()
      })

      try {
        return await Promise.race([
          limit(() => runDelegation(runtime, agent, ctx, instruction, context)),
          queueTimeoutPromise,
        ])
      } catch (err) {
        if (err instanceof QueueTimeoutError) {
          return { output: makeEnvelope('DELEGATION_QUEUE_TIMEOUT') }
        }
        log.error('[DelegateAgent] unexpected outer error:', err)
        return {
          output: makeEnvelope('SUBAGENT_FAILED', {
            message: err instanceof Error ? err.message : String(err),
          }),
        }
      } finally {
        if (queueTimer) clearTimeout(queueTimer)
      }
    },
  }
}

/**
 * 生成 delegate_agent 工具的 description。
 *
 * A1: 每个候选 agent 的 listing 行包含能力 metadata（tools / mcp / internet / scope）,
 * 让父 agent 在 LLM 推理阶段就能判断"这个 agent 能不能干"。
 *
 * 注意：本函数在 createDelegateAgentTool 时计算一次，**不会**在 agentManager
 * 业务 agent 列表变化时自动更新。AgentLoader 加载新 agent 后，相关 Agent 实例
 * 通常会重新构造（agent-manager.registerBusinessAgent 替换），届时 listing 自动更新。
 */
function buildDescription(
  agentManager: import('./agent-manager').AgentManager,
  allowedIds: string[] | null,
): string {
  let targetIds: string[]
  let scopeNote: string

  if (allowedIds === null) {
    targetIds = agentManager.listBusinessAgentIds()
    scopeNote = 'You can delegate to any registered business agent below.'
  } else {
    targetIds = allowedIds
    scopeNote =
      'You can ONLY delegate to the subagents listed below ' +
      "(declared in this agent's dependencies.subagents)."
  }

  const lines: string[] = []
  for (const id of targetIds) {
    const a = agentManager.getAgent(id)
    if (!a) continue
    const meta = formatAgentMetadata(a)
    lines.push(meta)
  }
  const listing = lines.length > 0 ? lines.join('\n\n') : '  (no subagents available)'

  return (
    'Delegate a sub-task to a registered business agent. The subagent runs in an isolated\n' +
    'session and returns only the final result text.\n\n' +
    `${scopeNote}\n\n` +
    'Available agents (use as agent_id parameter):\n' +
    listing +
    '\n\n' +
    'For multiple independent delegations, emit parallel `delegate_agent` tool_use blocks\n' +
    'in the same step. The subagent CANNOT see this conversation; provide all needed\n' +
    'background in the `context` field.'
  )
}

/**
 * A1: 渲染单个 agent 的 listing —— v2.0 契约骨架。
 *
 * 父 LLM 决定"该不该委托"的最小信息要素：
 *   name + id  — agent 标识
 *   description — 身份 + 会做 + 不会做
 *   first H2 section of agentPrompt — "When invoked" / "Workflow" 等
 *
 * v2.0 schema: flat fields — profile.name / profile.description / profile.agentPrompt
 */
function formatAgentMetadata(a: NonNullable<ReturnType<AgentManager['getAgent']>>): string {
  const profile = a.profile
  const lines: string[] = []
  lines.push(`### ${a.name} (id: ${a.id})`)

  const desc = profile?.description?.trim() ?? ''
  if (desc) {
    lines.push(desc)
  }

  // First H2 section of agentPrompt — gives delegating LLM enough context
  const firstSection = extractFirstSection(profile?.agentPrompt ?? '')
  if (firstSection) {
    lines.push('')
    lines.push(firstSection)
  }

  return lines.join('\n')
}

/**
 * Extract first H2 section from agentPrompt markdown.
 * Returns the section (from ## heading through next ## heading, exclusive).
 */
function extractFirstSection(agentPrompt: string): string {
  const lines = agentPrompt.split('\n')
  const start = lines.findIndex((l) => /^## /.test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  return lines
    .slice(start, end < 0 ? undefined : end)
    .join('\n')
    .trim()
}

// v3.7.2: A2 / B2 helpers (checkInstructionCompatibility / isSpecificEntity /
// collectProfileEntityText / checkOffTarget) 已删除 — 用 regex 抽实体做语义判断
// 是 J-SHOULD-2 反模式 "系统抢 LLM 活"。父 agent 通过 A1 capability listing 自行
// 判断该委托给哪个 agent;子 agent 输出由父 agent 自然语言判断是否完成 instruction。

// ─── 单次委托执行（限流后） ───────────────────────────────────────────

async function runDelegation(
  runtime: DelegationRuntime,
  agent: NonNullable<ReturnType<AgentManager['getAgent']>>,
  parentCtx: ToolExecuteContext,
  instruction: string,
  contextStr: string | undefined,
): Promise<{ output: unknown }> {
  const start = Date.now()

  // ─ Step 3: 创建子 session 行（status=running） ─
  const title = makeTitle(agent.name, instruction)
  const providerCtx = runtime.providerContextProvider(parentCtx.sessionId)

  const childSession = runtime.sessionRepo.create({
    title,
    provider_id: providerCtx.provider.id,
    model_id: extractModelId(providerCtx),
    workspace: parentCtx.workspace,
    agent_id: agent.id,
    parent_session_id: parentCtx.sessionId,
    parent_message_id: parentCtx.parentMessageId,
    status: 'running',
  })

  log.info(
    `[DelegateAgent] start agent_id=${agent.id} session=${childSession.id} ` +
      `parent=${parentCtx.sessionId}`,
  )

  // ─ Step 4: AbortController 链 + 执行超时 timer ─
  const childAbort = new AbortController()
  const cleanups: Array<() => void> = []

  const onParentAbort = () => childAbort.abort('parent_aborted')
  if (parentCtx.abortSignal) {
    if (parentCtx.abortSignal.aborted) {
      childAbort.abort('parent_aborted')
    } else {
      parentCtx.abortSignal.addEventListener('abort', onParentAbort, { once: true })
      cleanups.push(() => parentCtx.abortSignal?.removeEventListener('abort', onParentAbort))
    }
  }

  const execTimer = setTimeout(
    () => childAbort.abort('execution_timeout'),
    runtime.config.executionTimeoutMs,
  )
  if (execTimer.unref) execTimer.unref()
  cleanups.push(() => clearTimeout(execTimer))

  // ─ Step 5: 子 ReAct loop (B1: 自动注入父侧 metadata) ─
  const autoCtx = buildAutoContext(parentCtx)
  const userContent = [autoCtx, contextStr, instruction].filter(Boolean).join('\n\n')

  try {
    await runtime.runReactLoop({
      model: providerCtx.model,
      sessionId: childSession.id,
      messageId: uuidv4(),
      userContent,
      mappedAttachments: [],
      abortSignal: childAbort.signal,
      pipeline: runtime.pipeline,
      provider: providerCtx.provider,
      providerConfig: providerCtx.providerConfig,
      workspace: parentCtx.workspace,
      callbacks: {
        onTextDelta: () => {},
        onToolCall: () => {},
        onToolResult: () => {},
      },
      agent,
      // 父的 confirmTool 透传到子。子高风险工具（bash/write/edit）的弹窗仍可达 UI。
      confirmTool: parentCtx.confirmTool ?? noopConfirmTool,
      requestPermission: parentCtx.requestPermission,
      skillTracker: new SkillActivationTracker(),
      events: new ExecutionEventBus(),
      streamOptions: providerCtx.streamOptions,
    })

    // ─ Step 6: 提取最终 text ─
    const messages = messageRepo.listBySession(childSession.id)
    const lastAssistant = findLastAssistantWithText(messages)

    if (lastAssistant) {
      // C1: failure-recovery / auto-summary 文本回流为 ToolErrorEnvelope
      const recoveryCheck = detectRecoveryMarker(lastAssistant.text)
      if (recoveryCheck) {
        runtime.sessionRepo.updateStatus(childSession.id, 'completed')
        log.warn(
          `[DelegateAgent] recovery-mode detected agent=${agent.id} session=${childSession.id} ` +
            `marker="${recoveryCheck.marker}" duration=${Date.now() - start}ms`,
        )
        return {
          output: makeEnvelope('SUBAGENT_RECOVERY', {
            message: `Subagent reported failure-recovery: ${recoveryCheck.marker}`,
            last_text: recoveryCheck.cleanedText,
            child_session_id: childSession.id,
          }),
        }
      }

      // v3.7.2: B2 entity-binding check 已删除 —— regex 实体匹配判"子 agent 是否答对"
      // 是 "系统抢 LLM 活"反模式 (见 J-SHOULD-2)。父 agent 看到子输出后自己判断是否
      // 完成 instruction;假阳 (同义词/翻译/上下文相关称呼) 反而误伤合理输出。

      runtime.sessionRepo.updateStatus(childSession.id, 'completed')
      log.info(
        `[DelegateAgent] done code=COMPLETED session=${childSession.id} ` +
          `duration=${Date.now() - start}ms`,
      )
      return { output: lastAssistant.text }
    }

    // 子 loop 跑完但没有 text — 视作 max_steps 截断
    runtime.sessionRepo.updateStatus(childSession.id, 'completed')
    log.info(
      `[DelegateAgent] done code=SUBAGENT_MAX_STEPS session=${childSession.id} ` +
        `duration=${Date.now() - start}ms`,
    )
    return {
      output: makeEnvelope('SUBAGENT_MAX_STEPS', {
        truncated: true,
        last_text: '',
      }),
    }
  } catch (err) {
    return handleDelegationError(runtime, childSession.id, err, start, agent.id)
  } finally {
    for (const fn of cleanups) {
      try {
        fn()
      } catch (e) {
        log.warn('[DelegateAgent] cleanup error:', e)
      }
    }
  }
}

// ─── B1: 父侧 context 自动注入 ─────────────────────────────────────

/**
 * 从父 session 抽取最近 1 条 user message + 最近 3 条工具错误 → 结构化文本。
 *
 * 全部为事实 metadata，不含任何指令性话术（"请尽量"、"避免"等）。
 * 子 agent 自行从这段事实推断该如何工作。
 *
 * 故意不读 system 消息：父侧 system prompt 是父 agent 的私有约束，与子无关。
 */
export function buildAutoContext(parentCtx: ToolExecuteContext): string {
  if (!parentCtx.sessionId) return ''
  let messages: ChatMessage[]
  try {
    messages = messageRepo.listBySession(parentCtx.sessionId)
  } catch {
    return ''
  }
  if (messages.length === 0) return ''

  // 找最近一条 user message
  let lastUserText: string | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue
    const t = extractTextFromContent(messages[i].content)
    if (t.trim()) {
      lastUserText = t.trim().slice(0, 1500)
      break
    }
  }

  // 收集最近 3 条 tool error
  const toolErrors: string[] = []
  for (let i = messages.length - 1; i >= 0 && toolErrors.length < 3; i--) {
    if (messages[i].role !== 'tool') continue
    const errs = extractToolErrors(messages[i].content)
    for (const e of errs) {
      toolErrors.push(e)
      if (toolErrors.length >= 3) break
    }
  }

  if (!lastUserText && toolErrors.length === 0) return ''

  const lines: string[] = ['<parent-context auto-injected>']
  if (lastUserText) {
    lines.push(`origin-user-message: ${JSON.stringify(lastUserText)}`)
  }
  if (toolErrors.length > 0) {
    lines.push('recent-tool-failures:')
    for (const e of toolErrors) {
      lines.push(`  - ${e}`)
    }
  }
  lines.push('</parent-context>')
  return lines.join('\n')
}

function extractTextFromContent(rawContent: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    return rawContent
  }
  if (typeof parsed === 'string') return parsed
  if (!Array.isArray(parsed)) return ''
  const out: string[] = []
  for (const block of parsed) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push(b.text)
    }
  }
  return out.join('\n')
}

/** 从 tool 角色 message 解析含 isError 的 tool-result block，返回 errMsg 数组。 */
function extractToolErrors(rawContent: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const block of parsed) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type !== 'tool-result' && b.type !== 'tool_result') continue
    if (b.isError !== true) continue
    const toolName = typeof b.toolName === 'string' ? b.toolName : 'unknown'
    const outVal = b.output
    let outText: string
    if (typeof outVal === 'string') outText = outVal
    else if (
      outVal &&
      typeof outVal === 'object' &&
      typeof (outVal as Record<string, unknown>).value === 'string'
    ) {
      outText = (outVal as { value: string }).value
    } else {
      outText = JSON.stringify(outVal ?? {})
    }
    out.push(`${toolName}: ${outText.slice(0, 200).replace(/\s+/g, ' ').trim()}`)
  }
  return out
}

// ─── C1: failure-recovery 标识检测 ─────────────────────────────────

const RECOVERY_MARKERS = [
  /^\s*\[failure-recovery[^\]]*\]/,
  /^\s*\[auto-summary[^\]]*\]/,
  /^\s*\[auto-halt\]/,
]

function detectRecoveryMarker(text: string): { marker: string; cleanedText: string } | null {
  for (const re of RECOVERY_MARKERS) {
    const m = text.match(re)
    if (m) {
      // 把 marker 行剥掉，剩余正文返回
      const cleaned = text
        .slice(m[0].length)
        .replace(/^\s*\n/, '')
        .trim()
      return { marker: m[0].trim(), cleanedText: cleaned }
    }
  }
  return null
}

// v3.7.2: B2 checkOffTarget 删除 — 见 J-SHOULD-2 反模式。

// ─── 错误分类 ─────────────────────────────────────────────────────────

function handleDelegationError(
  runtime: DelegationRuntime,
  childSessionId: string,
  err: unknown,
  start: number,
  agentId: string,
): { output: unknown } {
  let code = 'SUBAGENT_FAILED'
  const message = err instanceof Error ? err.message : String(err)

  if (err instanceof Error && err.name === 'AbortError') {
    const reason = (err as Error & { cause?: unknown }).cause ?? message
    if (String(reason).includes('execution_timeout')) {
      code = 'SUBAGENT_TIMEOUT'
    } else {
      code = 'SUBAGENT_ABORTED'
    }
  } else if (/MCP|mcp/.test(message) && /init|connect|start/i.test(message)) {
    code = 'SUBAGENT_MCP_INIT_FAILED'
  }

  log.error(
    `[DelegateAgent] failed agent_id=${agentId} session=${childSessionId} code=${code}`,
    err,
  )

  try {
    runtime.sessionRepo.updateStatus(childSessionId, 'aborted')
  } catch (statusErr) {
    log.warn('[DelegateAgent] updateStatus failed:', statusErr)
  }

  log.info(
    `[DelegateAgent] done code=${code} session=${childSessionId} ` +
      `duration=${Date.now() - start}ms`,
  )

  return { output: makeEnvelope(code, { message }) }
}

// ─── 辅助 ─────────────────────────────────────────────────────────────

function makeTitle(agentName: string, instruction: string): string {
  const trimmed = instruction.slice(0, 40)
  const ellipsis = instruction.length > 40 ? '...' : ''
  return `${agentName}: ${trimmed}${ellipsis}`
}

function extractModelId(providerCtx: ProviderContext): string | undefined {
  const m = providerCtx.model as unknown as { modelId?: string }
  return typeof m?.modelId === 'string' ? m.modelId : undefined
}

interface AssistantText {
  text: string
}

function findLastAssistantWithText(messages: ChatMessage[]): AssistantText | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(m.content)
    } catch {
      const s = m.content?.toString?.() ?? ''
      if (s.trim().length > 0) return { text: s }
      continue
    }
    if (typeof parsed === 'string' && parsed.trim().length > 0) {
      return { text: parsed }
    }
    if (Array.isArray(parsed)) {
      const textBlocks = parsed
        .filter(
          (b): b is { type: string; text: string } =>
            !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text',
        )
        .map((b) => b.text)
        .filter((t) => typeof t === 'string')
      if (textBlocks.length > 0 && textBlocks.join('').trim().length > 0) {
        return { text: textBlocks.join('') }
      }
    }
  }
  return null
}

const noopConfirmTool: import('../ipc/tool-confirm').ToolConfirmPort = async () => false
