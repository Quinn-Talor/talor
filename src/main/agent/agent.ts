// src/main/agent/agent.ts — 业务层：Agent 执行者实例 (Schema 1.0)
//
// 统一模型：平台 Agent 和业务 Agent 都是 Agent 实例，区别在构造参数。
// 构造后不可变（readonly），线程安全。多 session 并发使用同一 Agent 不会互相干扰。

import { join } from 'path'
import log from 'electron-log'
import type { AgentProfile, AcceptanceCriterion, KnowledgeRef } from '@shared/types/agent'
import type { ToolDefinition } from '../tools/types'
import type { BuiltinToolRegistry } from './builtin-registry'
import { ToolRegistry } from './agent-toolset'
import type { McpToolSource } from './agent-toolset'
import type { SkillRegistry } from '../skills/registry'
import { createSkillTool } from '../skills/skill-tool'
import { createSearchTool } from '../tools/builtin/search-tool'
import { createDelegateAgentTool } from './delegate-agent'
import type { DelegationRuntime } from './delegate-agent'

export interface AgentOptions {
  profile: AgentProfile
  source: string | null
  builtinRegistry: BuiltinToolRegistry
  mcpRegistry: McpToolSource | null
  skillRegistry: SkillRegistry
  /**
   * 委托运行时。统一注入给所有 agent。
   * 委托能力由 profile.method.collaboration 决定：
   *   - allowAnyBusinessSubagent=true → 全开放（仅 __chat__）
   *   - subagents=[...] → 仅可委托列表内 agent
   *   - 都没声明 → scope=[]，工具持有但 listing 为空
   */
  delegationRuntime?: DelegationRuntime
}

export class Agent {
  readonly profile: AgentProfile
  readonly source: string | null
  readonly toolRegistry: ToolRegistry
  readonly mcpRegistry: McpToolSource | null
  readonly skillRegistry: SkillRegistry

  /** 委托运行时引用。null 表示此 agent 不能下钻 */
  readonly delegationRuntime: DelegationRuntime | null

  /**
   * delegate_agent 工具的 scope:
   *   - null:    全部业务 agent（allowAnyBusinessSubagent=true）
   *   - []:      不能下钻（持有工具但 listing 空）
   *   - [...]:   显式列表
   */
  readonly allowedAgentIds: string[] | null

  /**
   * 装配阶段产生的最终 acceptance 列表 = mission.outcomes.flatMap(verifyBy) + implicit
   *
   * Implicit acceptance 注入规则 (Schema 1.0 §15):
   *   每个 method.knowledge[type='file', required=true] 自动注入虚拟 criterion:
   *     { type:'tool-was-used', toolName:'read', kind:'deterministic', severity:'must',
   *       _implicit:true, _knowledgePath:<path> }
   *   contract-guard.verify 检查 read 工具被调用且 input.path 命中 _knowledgePath
   */
  readonly resolvedAcceptance: AcceptanceCriterion[]

  constructor(opts: AgentOptions) {
    this.profile = opts.profile
    this.source = opts.source
    this.mcpRegistry = opts.mcpRegistry
    this.skillRegistry = opts.skillRegistry

    const tools = opts.profile.method.tools ?? []
    const allowedTools = new Set(tools.filter((t) => !t.disabled).map((t) => t.name))
    const disabledTools = new Set(tools.filter((t) => t.disabled).map((t) => t.name))

    // v8.1: 元工具注入条件解耦 —— 按 profile 声明派生,而不是按 registry 是否 ready。
    //   skill 工具:     method.skills 非空 → 注入(skill 还没安装也注入,LLM 调时给 missing 错误)
    //   search_tool:    profile 声明了 mcpServers (即便空数组,显式 intent) OR
    //                   有 mcpRegistry infrastructure (非 null,不论当前 count) → 注入
    //                   ※ 不能用 listRegisteredTools().length 判断 — Playwright 等
    //                     server 异步连接,Agent 构造时 count 可能为 0,但运行时已有。
    //   delegate_agent: 总是注入(由下方 collaboration 段处理)
    const agentTools: ToolDefinition[] = []
    const declaredSkills = opts.profile.method.skills ?? []
    if (declaredSkills.length > 0 || !opts.skillRegistry.isEmpty()) {
      agentTools.push(createSkillTool(opts.skillRegistry))
    }
    const declaredMcpIntent = opts.profile.method.mcpServers !== undefined
    if (declaredMcpIntent || opts.mcpRegistry !== null) {
      agentTools.push(createSearchTool(opts.mcpRegistry ?? null))
    }

    // 委托能力配置（Schema 1.0：从 method.collaboration 读取）
    const collab = opts.profile.method.collaboration
    let allowedAgentIds: string[] | null = null
    let delegationRuntime: DelegationRuntime | null = null

    if (opts.delegationRuntime) {
      const subagentDeps = collab?.subagents ?? []
      const allowAny = collab?.allowAnyBusinessSubagent === true

      if (allowAny && subagentDeps.length > 0) {
        log.warn(
          `[Agent ${opts.profile.identity.id}] Both allowAnyBusinessSubagent and subagents declared; ` +
            `allowAnyBusinessSubagent takes precedence (subagents list ignored).`,
        )
      }

      allowedAgentIds = allowAny ? null : subagentDeps.map((s) => s.id)
      delegationRuntime = opts.delegationRuntime

      agentTools.push(
        createDelegateAgentTool({
          runtime: opts.delegationRuntime,
          allowedAgentIds,
        }),
      )
    } else {
      // 没传 delegationRuntime → 不能下钻
      allowedAgentIds = null
    }

    this.delegationRuntime = delegationRuntime
    this.allowedAgentIds = allowedAgentIds

    this.toolRegistry = new ToolRegistry(
      opts.builtinRegistry,
      opts.mcpRegistry,
      allowedTools,
      agentTools,
      disabledTools,
    )

    // resolvedAcceptance: profile + implicit
    this.resolvedAcceptance = buildResolvedAcceptance(opts.profile)
  }

  get skillsDir(): string | null {
    return this.source ? join(this.source, 'skills') : null
  }

  get knowledgeDir(): string | null {
    return this.source ? join(this.source, 'knowledge') : null
  }

  get id(): string {
    return this.profile.identity.id
  }

  get name(): string {
    return this.profile.identity.name
  }
}

/**
 * v8: acceptance 唯一权威源 = mission.outcomes[].verifyBy。
 * 装配阶段把所有 outcomes 的 verifyBy 平铺,再为 knowledge.required=true 的 file 注入
 * implicit 'tool-was-used' criterion (Schema 1.0 RULE 15)。
 */
export function buildResolvedAcceptance(profile: AgentProfile): AcceptanceCriterion[] {
  const fromOutcomes: AcceptanceCriterion[] = (profile.mission.outcomes ?? []).flatMap(
    (o) => o.verifyBy ?? [],
  )
  const implicit: AcceptanceCriterion[] = []

  const knowledge = profile.method.knowledge ?? []
  for (const k of knowledge) {
    if (isRequiredFile(k)) {
      implicit.push({
        type: 'tool-was-used',
        toolName: 'read',
        kind: 'deterministic',
        severity: 'must',
        _implicit: true,
        _knowledgePath: k.path,
      })
    }
  }

  return [...fromOutcomes, ...implicit]
}

function isRequiredFile(
  k: KnowledgeRef,
): k is Extract<KnowledgeRef, { type: 'file' }> & { required: true } {
  return k.type === 'file' && k.required === true
}
