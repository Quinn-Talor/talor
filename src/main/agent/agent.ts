// src/main/agent/agent.ts — 业务层：Agent 执行者实例
//
// 统一模型：平台 Agent 和业务 Agent 都是 Agent 实例，区别在构造参数。
// 构造后不可变（readonly），线程安全。多 session 并发使用同一 Agent 不会互相干扰。

import { join } from 'path'
import type { AgentProfile } from '@shared/types/agent'
import type { ToolDefinition } from '../tools/types'
import type { BuiltinToolRegistry } from './builtin-registry'
import { ToolRegistry } from './tool-registry'
import type { McpToolSource } from './tool-registry'
import type { SkillRegistry } from '../skills/registry'
import { createSkillTool } from '../skills/skill-tool'
import { createSearchTool } from '../tools/builtin/search-tool'

export interface AgentOptions {
  profile: AgentProfile
  source: string | null
  builtinRegistry: BuiltinToolRegistry
  mcpRegistry: McpToolSource | null
  skillRegistry: SkillRegistry
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

    const agentTools: ToolDefinition[] = []
    if (!opts.skillRegistry.isEmpty()) {
      agentTools.push(createSkillTool(opts.skillRegistry))
    }
    if (opts.mcpRegistry) {
      // search_tool 持有 mcpRegistry 引用做按需查询。是否暴露给 LLM 由
      // ToolRegistry.listBuiltinTools 在 mcpRegistry 实际工具数 > 0 时决定。
      agentTools.push(createSearchTool(opts.mcpRegistry))
    }

    this.toolRegistry = new ToolRegistry(
      opts.builtinRegistry,
      opts.mcpRegistry,
      allowedTools,
      agentTools,
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
