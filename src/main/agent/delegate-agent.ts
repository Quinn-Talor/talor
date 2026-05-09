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

/** Session 删除路径调用，防止 limiter Map 泄漏。 */
export function clearLimiter(sessionId: string): void {
  limiterPerSession.delete(sessionId)
}

// 仅供测试访问
export const __TEST__ = { limiterPerSession }

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

      // ─ Step 2: limiter + 排队超时 race ─
      const limit = getLimiter(ctx.sessionId, runtime.config.maxConcurrencyPerSession)
      const queueLen = limit.pendingCount
      if (queueLen > 0) {
        log.info(
          `[DelegateAgent] queued sessionId=${ctx.sessionId} pending=${queueLen} active=${limit.activeCount}`,
        )
      }

      // 排队超时 timer。如果 limit 在 queueTimeoutMs 内没把任务调度起来，整体 race 失败。
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
        // 任何 limit() 内部抛出的异常应已被 runDelegation 内部 catch 并转 envelope。
        // 走到这里说明有意外路径——保守降级 SUBAGENT_FAILED。
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
 * 生成 delegate_agent 工具的 description（含 listing）。
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
    const desc = (a.profile.identity.description ?? '').slice(0, 80)
    lines.push(`- ${id} — ${a.profile.identity.name}${desc ? `: ${desc}` : ''}`)
  }
  const listing = lines.length > 0 ? lines.join('\n') : '  (no subagents available)'

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

  // ─ Step 5: 子 ReAct loop ─
  const userContent = contextStr ? `${contextStr}\n\n${instruction}` : instruction

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
      // 缺失时退化为永远 deny（noop 已在 build-tools 现有 confirmTool 缺失逻辑覆盖）。
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

  // AbortError 来自 abortSignal 触发；用 cause 区分超时 vs 用户停止
  if (err instanceof Error && err.name === 'AbortError') {
    // childAbort.abort(reason) 在 cause 字段或 signal.reason 体现
    const reason =
      (err as Error & { cause?: unknown }).cause ??
      // childAbort 的 reason 最可靠的来源不在 err 上，需要从外部捕获，
      // 但通常 err.message 含 reason 字符串
      message
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
  // LanguageModel 的 modelId 字段；不同 SDK 版本字段位置不同，保守取
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
      // content 是纯字符串
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
