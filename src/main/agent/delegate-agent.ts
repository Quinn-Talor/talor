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
import { extractEntities, extractEntitySet } from './entity-extractor'

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
  INSTRUCTION_OUT_OF_SCOPE:
    'The instruction references entities the subagent profile does not cover. Pick a different agent or rephrase.',
  DELEGATION_BUDGET_EXHAUSTED:
    'This subagent has already been invoked the maximum number of times in this session. Try a different approach or agent.',
  SUBAGENT_RECOVERY:
    'Subagent entered failure-recovery mode (3+ consecutive tool failures). Treat as failure; investigate sub-session for details.',
  SUBAGENT_OFF_TARGET:
    'Subagent output does not mention any entity from the instruction. Output likely drifted to an unrelated subject.',
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

      // ─ Step 1d (A2): 兼容性前置检查 ─
      const compat = checkInstructionCompatibility(instruction, agent.profile)
      if (!compat.compatible) {
        log.info(`[DelegateAgent] scope-mismatch: agent=${agent_id} reason=${compat.reason}`)
        return {
          output: makeEnvelope('INSTRUCTION_OUT_OF_SCOPE', {
            message: compat.reason,
            instruction_entities: compat.instructionEntities,
            profile_entities: compat.profileEntities,
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
 * A1: 渲染单个 agent 的 listing —— 委托契约骨架（自适应契约型）。
 *
 * 父 LLM 决定"该不该委托"的最小信息要素：
 *   does     — 这个 agent 能做什么 (路由决策核心)
 *   won't    — 它声明不做什么 (可选,辅助)
 *   needs    — 委托前必须收齐的 input
 *   returns  — 它会回来的产物形式
 *
 * 鲁棒性：四字段都按需渲染（缺则跳过），且 `does` 有降级链：
 *   scope.in[] → capabilities[] → objective → description
 *   保证 valid profile 一定能渲染出非空 does。
 *
 * 自适应 inline vs list（避免短数组占多行）：
 *   1 条 → inline 与字段名同行
 *   2-3 条且每条 ≤30 字 → inline 以 " / " 分隔
 *   其它 → 展开为列表
 *
 * 故意不暴露：
 *   - description / objective / outcomes / capabilities（仅作 does fallback,不重复渲染）
 *   - 可选 inputs (required=false) / inputs.examples
 *   - tools / mcpServers / skills / cli（实现细节）
 *   - outcomes.priority / deliverables.trigger/template/schema（决策无关）
 */
function formatAgentMetadata(a: NonNullable<ReturnType<AgentManager['getAgent']>>): string {
  const profile = a.profile ?? ({} as import('@shared/types/agent').AgentProfile)
  const identity = profile.identity ?? ({} as { name?: string; description?: string })
  const method = profile.method ?? ({} as import('@shared/types/agent').AgentMethod)
  const mission = profile.mission ?? ({} as import('@shared/types/agent').AgentMission)
  const delivery = profile.delivery ?? ({} as import('@shared/types/agent').AgentDelivery)

  const lines: string[] = []
  const displayName = identity.name ?? a.name ?? a.id
  lines.push(`- ${a.id} — ${displayName}`)

  // ─ does: 降级链 scope.in → capabilities → objective → description ─
  const scopeIn = mission.scope?.in ?? []
  const capabilities = method.capabilities ?? []
  if (scopeIn.length > 0) {
    appendField(lines, 'does', scopeIn)
  } else if (capabilities.length > 0) {
    appendField(lines, 'does', capabilities)
  } else if (mission.objective?.trim()) {
    lines.push(`    does: ${mission.objective.trim()}`)
  } else if (identity.description?.trim()) {
    lines.push(`    does: ${identity.description.trim()}`)
  }

  // ─ won't: 仅 scope.out 存在时 ─
  const scopeOut = mission.scope?.out ?? []
  if (scopeOut.length > 0) {
    appendField(lines, "won't", scopeOut)
  }

  // ─ needs: 仅 required inputs ─
  const requiredInputs = (mission.inputs ?? []).filter((i) => i.required)
  if (requiredInputs.length > 0) {
    const formatted = requiredInputs.map((i) => `${i.id} (${i.type}) — ${i.description}`)
    appendField(lines, 'needs', formatted)
  }

  // ─ returns: deliverables 形式（id + format） ─
  const deliverables = delivery.deliverables ?? []
  if (deliverables.length > 0) {
    const formatted = deliverables.map((d) => `${d.id} (${d.format})`)
    appendField(lines, 'returns', formatted)
  }

  return lines.join('\n')
}

/**
 * Helper: 把 items 渲染到 lines，自适应 inline vs list。
 *
 * 规则:
 *   1 条                                  → "    {field}: {item}"
 *   2-3 条 且 每条 ≤30 字                  → "    {field}: a / b / c"
 *   其它（≥4 条 OR 含长项 OR 含换行）      → 展开列表
 */
function appendField(lines: string[], field: string, items: string[]): void {
  if (items.length === 0) return
  if (items.length === 1) {
    lines.push(`    ${field}: ${items[0]}`)
    return
  }
  const allShort = items.every((s) => s.length <= 30 && !s.includes('\n'))
  if (items.length <= 3 && allShort) {
    lines.push(`    ${field}: ${items.join(' / ')}`)
    return
  }
  lines.push(`    ${field}:`)
  for (const s of items) lines.push(`      - ${s}`)
}

// ─── A2: 兼容性检查 ─────────────────────────────────────────────────

interface CompatibilityResult {
  compatible: boolean
  reason: string
  instructionEntities: string[]
  profileEntities: string[]
}

/**
 * 判断一个抽取出的实体字符串是否"高置信具体"。
 *
 * 设计动机（specificity filter）：实体抽取器重叠滑窗会产出大量低置信短候选
 * （"股写" / "为百" / 单个 2 字中文等）。如果直接拿这些候选做 A2 拒绝判定,
 * 会把通用 agent（如 "为A股写诗"）误判为有"具体实体绑定",导致与
 * "为TSLA写诗" 这类 instruction 不匹配 → REJECT,父 agent 退缩。
 *
 * 高置信具体实体定义：
 *   - 中文 ≥ 3 字（"中际旭创" / "百度公司" 等真实命名实体长度区间）
 *   - 拉丁字母 ≥ 4 位 ticker（"BIDU" / "TSLA" / "NVDA"；2-3 位太多缩写假阳）
 *   - 任意 stock-code（6 位数字 + 交易所后缀,几乎不会假阳）
 *   - 任意 path（/x/y/z）
 */
function isSpecificEntity(text: string): boolean {
  if (!text) return false
  // 中文 ≥3 字
  if (/^[一-龥]{3,}$/.test(text)) return true
  // 含拉丁: ticker (≥4 字) 或 stock-code 或 path
  if (/^[A-Z]{4,}(?:\.[A-Z]{2})?$/.test(text)) return true
  if (/^\d{6}\.[A-Z]{2}$/.test(text)) return true
  if (/^\//.test(text)) return true
  return false
}

/**
 * 检查 instruction 中的实体与 agent profile 是否有交集。
 *
 * 判定逻辑（保守 — 倾向放行）：
 *   1. instruction **高置信具体实体** 集合为空 → PASS（不强制要求）
 *   2. profile **高置信具体实体** 集合为空（通用 agent）→ PASS（无具体偏向,可处理任何输入）
 *   3. 双方均有具体实体, 且 instruction 实体在 profile 文本中无子串
 *      AND profile 实体在 instruction 文本中也无子串 → REJECT
 *   4. 否则 → PASS
 *
 * specificity filter（缺环 2）：仅"高置信具体"实体参与拒绝判定。
 * 抽取器返回的低置信短碎片（2 字中文 / 2-3 字 ticker / 滑窗内部纯字符组合）
 * 不参与, 否则会让通用 agent 被错误标记为"具有 specific 绑定"。
 */
export function checkInstructionCompatibility(
  instruction: string,
  profile: import('@shared/types/agent').AgentProfile,
): CompatibilityResult {
  const profileText = collectProfileEntityText(profile)
  const allIEntities = extractEntitySet(instruction)
  const allPEntities = extractEntitySet(profileText)

  // specificity filter: 仅高置信具体实体参与拒绝判定
  const iSpecific = [...allIEntities].filter(isSpecificEntity)
  const pSpecific = [...allPEntities].filter(isSpecificEntity)

  if (iSpecific.length === 0 || pSpecific.length === 0) {
    return {
      compatible: true,
      reason:
        iSpecific.length === 0
          ? 'instruction has no high-confidence specific entity'
          : 'profile has no high-confidence specific entity (treated as generic)',
      instructionEntities: iSpecific,
      profileEntities: pSpecific,
    }
  }

  // 双向 ALL-entity 子串匹配：
  //   - 拒绝判定基于 specific 集合 (避免低置信噪声触发误判)
  //   - 但 PASS 通道使用 ALL 实体集合做反向子串覆盖, 让 2 字 profile entity 能"接住"
  //     3 字 instruction entity (如 instruction 含 "搜索百度"<=specific>, profile 提及
  //     "百度"<=2字 in allPEntities>; "搜索百度".includes("百度") 应触发 PASS)。
  for (const ie of iSpecific) {
    if (profileText.includes(ie)) {
      return {
        compatible: true,
        reason: `instruction entity "${ie}" found in profile text`,
        instructionEntities: iSpecific,
        profileEntities: pSpecific,
      }
    }
    for (const pe of allPEntities) {
      if (ie.includes(pe) && pe.length >= 2) {
        return {
          compatible: true,
          reason: `profile entity "${pe}" is substring of instruction entity "${ie}"`,
          instructionEntities: iSpecific,
          profileEntities: pSpecific,
        }
      }
    }
  }
  for (const pe of pSpecific) {
    if (instruction.includes(pe)) {
      return {
        compatible: true,
        reason: `profile entity "${pe}" found in instruction`,
        instructionEntities: iSpecific,
        profileEntities: pSpecific,
      }
    }
    for (const ie of allIEntities) {
      if (pe.includes(ie) && ie.length >= 2) {
        return {
          compatible: true,
          reason: `instruction entity "${ie}" is substring of profile entity "${pe}"`,
          instructionEntities: iSpecific,
          profileEntities: pSpecific,
        }
      }
    }
  }

  return {
    compatible: false,
    reason: `instruction references entities [${iSpecific.join(', ')}] but profile is bound to entities [${pSpecific.join(', ')}]; no overlap.`,
    instructionEntities: iSpecific,
    profileEntities: pSpecific,
  }
}

function collectProfileEntityText(profile: import('@shared/types/agent').AgentProfile): string {
  const identity = profile?.identity ?? ({} as { name?: string; description?: string })
  const mission = profile?.mission ?? ({} as import('@shared/types/agent').AgentMission)
  const method = profile?.method ?? ({} as import('@shared/types/agent').AgentMethod)

  const parts: string[] = [identity.name ?? '', identity.description ?? '', mission.objective ?? '']
  for (const o of mission.outcomes ?? []) {
    if (o?.description) parts.push(o.description)
  }
  if (mission.scope?.in) parts.push(...mission.scope.in)
  if (mission.scope?.out) parts.push(...mission.scope.out)
  for (const cap of method.capabilities ?? []) parts.push(cap)
  for (const k of method.knowledge ?? []) {
    if (k?.description) parts.push(k.description)
    if (k?.type === 'text' && (k as { content?: string }).content) {
      parts.push((k as { content: string }).content)
    }
  }
  return parts.filter(Boolean).join('\n')
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

      // B2: instruction 实体硬绑定 — 子最终输出必须提及任一实体
      const offTarget = checkOffTarget(instruction, lastAssistant.text)
      if (offTarget) {
        runtime.sessionRepo.updateStatus(childSession.id, 'completed')
        log.warn(
          `[DelegateAgent] off-target detected agent=${agent.id} session=${childSession.id} ` +
            `expected=[${offTarget.expected.join(',')}]`,
        )
        return {
          output: makeEnvelope('SUBAGENT_OFF_TARGET', {
            message: `Subagent output does not mention any instruction entity (expected one of: ${offTarget.expected.join(', ')}).`,
            expected_entities: offTarget.expected,
            last_text: lastAssistant.text,
            child_session_id: childSession.id,
          }),
        }
      }

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

// ─── B2: 实体偏离检测 ─────────────────────────────────────────────

/**
 * 判断子 agent 输出是否漂离了 instruction 指向的实体。
 *
 * 仅在"高置信实体存在"时启用,避免对 translation 等跨语言任务误伤：
 *   - ticker / stock-code / path：始终视为锚点
 *   - cn-name：仅当长度 ≥ 3 AND 输出含中文字符时视为锚点
 *     (输出为纯外语时可能是 translation 任务,跳过 cn-name 检查)
 *
 * 命中任一锚点的子串即 PASS；全部不命中才返回 expected 列表用于失败信封。
 */
function checkOffTarget(instruction: string, finalText: string): { expected: string[] } | null {
  const iEntities = extractEntities(instruction)
  if (iEntities.length === 0) return null

  const outputHasChinese = /[一-龥]/.test(finalText)
  const anchors: string[] = []
  for (const e of iEntities) {
    if (e.category === 'ticker' || e.category === 'stock-code' || e.category === 'path') {
      anchors.push(e.text)
    } else if (e.category === 'cn-name' && e.text.length >= 3 && outputHasChinese) {
      anchors.push(e.text)
    }
  }
  if (anchors.length === 0) return null

  // 双向子串匹配：anchor 出现在输出，或输出的任一实体是 anchor 的子串。
  // 后者覆盖 instruction 抽取出 3-char "为百度" 但输出含 2-char "百度" 的场景。
  const outputEntityTexts = extractEntities(finalText).map((e) => e.text)
  const hit = anchors.some((a) => {
    if (finalText.includes(a)) return true
    if (outputEntityTexts.some((o) => a.includes(o))) return true
    return false
  })
  if (hit) return null
  return { expected: anchors }
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
