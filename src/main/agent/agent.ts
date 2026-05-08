// src/main/agent/agent.ts — 业务层：Agent 执行者实例
//
// 统一模型：平台 Agent 和业务 Agent 都是 Agent 实例，区别在构造参数。
// 构造后不可变（readonly），线程安全。多 session 并发使用同一 Agent 不会互相干扰。

import { join } from 'path'
import log from 'electron-log'
import type { AgentProfile } from '@shared/types/agent'
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
   * 委托运行时。仅注入给平台 agent（`__chat__` / `__coordinator__` /
   * `__crystallizer__`）。业务 agent 永远 undefined（架构隔离层）——
   * 即使业务 agent profile 没声明 disabledTools，也拿不到 delegate_agent
   * 工具实例。这是与 disabledTools profile 字段正交的第二层防御。
   */
  delegationRuntime?: DelegationRuntime
}

export class Agent {
  readonly profile: AgentProfile
  readonly source: string | null
  readonly toolRegistry: ToolRegistry
  readonly mcpRegistry: McpToolSource | null
  readonly skillRegistry: SkillRegistry

  constructor(opts: AgentOptions) {
    this.profile = opts.profile
    this.source = opts.source
    this.mcpRegistry = opts.mcpRegistry
    this.skillRegistry = opts.skillRegistry

    const allowedTools = new Set(opts.profile.dependencies.tools.map((t) => t.name))
    const disabledTools = new Set(opts.profile.dependencies.disabledTools ?? [])

    const agentTools: ToolDefinition[] = []
    if (!opts.skillRegistry.isEmpty()) {
      agentTools.push(createSkillTool(opts.skillRegistry))
    }
    if (opts.mcpRegistry) {
      // search_tool 持有 mcpRegistry 引用做按需查询。是否暴露给 LLM 由
      // ToolRegistry.listBuiltinTools 在 mcpRegistry 实际工具数 > 0 时决定。
      agentTools.push(createSearchTool(opts.mcpRegistry))
    }
    if (opts.delegationRuntime) {
      // 统一注入 delegate_agent 工具。scope 由 profile 决定：
      //   - allowAnyBusinessSubagent=true → null（全开放）
      //   - subagents=[...] → 显式 allow list
      //   - 都没声明 → []（持有工具但 listing 为空，LLM 看到无目标自然不会调）
      const subagentDeps = opts.profile.dependencies.subagents ?? []
      const allowAny = opts.profile.dependencies.allowAnyBusinessSubagent === true

      if (allowAny && subagentDeps.length > 0) {
        log.warn(
          `[Agent ${opts.profile.id}] Both allowAnyBusinessSubagent and subagents declared; ` +
            `allowAnyBusinessSubagent takes precedence (subagents list ignored).`,
        )
      }

      const allowedAgentIds: string[] | null = allowAny ? null : subagentDeps.map((s) => s.id)

      agentTools.push(
        createDelegateAgentTool({
          runtime: opts.delegationRuntime,
          allowedAgentIds,
        }),
      )
    }

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
