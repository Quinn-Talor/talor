// src/main/agent/agent.ts — 业务层：Agent 执行者实例 (Schema 2.0)
//
// 统一模型：平台 Agent 和业务 Agent 都是 Agent 实例，区别在构造参数。
// 构造后不可变（readonly），线程安全。多 session 并发使用同一 Agent 不会互相干扰。

import { join } from 'path'
import log from 'electron-log'
import type { AgentProfile, BuiltinToolName } from '@shared/types/agent'
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
   * 委托能力由 profile.subagents 决定：
   *   - allowAny=true → 全开放（仅 __chat__）
   *   - ids=[...] → 仅可委托列表内 agent
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
   *   - null:    全部业务 agent（allowAny=true）
   *   - []:      不能下钻（持有工具但 listing 空）
   *   - [...]:   显式列表
   */
  readonly allowedAgentIds: string[] | null

  constructor(opts: AgentOptions) {
    this.profile = opts.profile
    this.source = opts.source
    this.mcpRegistry = opts.mcpRegistry
    this.skillRegistry = opts.skillRegistry

    // Schema 2.0: tools is BuiltinToolName[] (string array, not objects)
    const declaredTools: BuiltinToolName[] = opts.profile.tools ?? []
    const allowedTools = new Set<string>(declaredTools)
    // v2.0 has no disabled concept at profile level — empty set
    const disabledTools = new Set<string>()

    // 元工具注入:
    //   skill 工具:     profile.skills 非空 OR skillRegistry 已有内容 → 注入
    //   search_tool:    profile 声明了 mcpServers OR mcpRegistry 非 null → 注入
    //   delegate_agent: 总是注入（由下方 collaboration 段处理）
    const agentTools: ToolDefinition[] = []
    const declaredSkills = opts.profile.skills ?? []
    if (declaredSkills.length > 0 || !opts.skillRegistry.isEmpty()) {
      agentTools.push(createSkillTool(opts.skillRegistry))
    }
    const declaredMcpIntent = opts.profile.mcpServers !== undefined
    if (declaredMcpIntent || opts.mcpRegistry !== null) {
      agentTools.push(createSearchTool(opts.mcpRegistry ?? null))
    }

    // 委托能力配置（Schema 2.0：从 profile.subagents 读取）
    const collab = opts.profile.subagents
    let allowedAgentIds: string[] | null = null
    let delegationRuntime: DelegationRuntime | null = null

    if (opts.delegationRuntime) {
      const subagentDeps = collab?.ids ?? []
      const allowAny = collab?.allowAny === true

      if (allowAny && subagentDeps.length > 0) {
        log.warn(
          `[Agent ${opts.profile.id}] Both allowAny and ids declared; ` +
            `allowAny takes precedence (ids list ignored).`,
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
  }

  get skillsDir(): string | null {
    return this.source ? join(this.source, 'skills') : null
  }

  get knowledgeDir(): string | null {
    return this.source ? join(this.source, 'knowledge') : null
  }

  get id(): string {
    return this.profile.id
  }

  get name(): string {
    return this.profile.name
  }
}
