// src/main/agent/tool-registry.ts — 业务层：Agent 的工具注册中心
//
// 组合 BuiltinToolRegistry + Agent 专属工具 + MCP tools → 白名单过滤。
// 对外提供统一的 listTools() / execute()，调用方不感知工具来源。
// 每个 Agent 实例持有独立的 ToolRegistry，构造后只读，线程安全。

import type { ToolMetadata, ToolDefinition, ToolExecuteContext } from '../tools/types'
import type { BuiltinToolRegistry } from './builtin-registry'

export const ALWAYS_AVAILABLE_TOOLS = new Set(['read', 'ls', 'glob', 'grep', 'skill'])

export interface McpToolSource {
  listRegisteredTools(): ToolMetadata[]
  execute(toolName: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }>
}

export class ToolRegistry {
  private readonly agentToolMap: ReadonlyMap<string, ToolDefinition>

  constructor(
    private readonly builtinRegistry: BuiltinToolRegistry,
    private readonly mcpRegistry: McpToolSource | null,
    private readonly allowedTools: ReadonlySet<string>,
    agentTools?: ToolDefinition[],
  ) {
    const map = new Map<string, ToolDefinition>()
    for (const t of agentTools ?? []) map.set(t.name, t)
    this.agentToolMap = map
  }

  listTools(): ToolMetadata[] {
    const builtinTools = this.builtinRegistry.listAll()
    const agentTools: ToolMetadata[] = Array.from(this.agentToolMap.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      schema: t.schema,
      riskLevel: t.riskLevel,
    }))
    const mcpTools = this.mcpRegistry?.listRegisteredTools() ?? []
    const all = [...builtinTools, ...agentTools, ...mcpTools]

    if (this.allowedTools.size === 0) return all
    return all.filter(t =>
      this.allowedTools.has(t.name) || ALWAYS_AVAILABLE_TOOLS.has(t.name),
    )
  }

  getToolNames(): string[] {
    return this.listTools().map(t => t.name)
  }

  hasTool(name: string): boolean {
    return this.listTools().some(t => t.name === name)
  }

  getBuiltinTool(name: string): ToolDefinition | undefined {
    return this.builtinRegistry.getTool(name)
  }

  async execute(name: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const agentTool = this.agentToolMap.get(name)
    if (agentTool) return agentTool.execute(input, context)

    const builtinTool = this.builtinRegistry.getTool(name)
    if (builtinTool) return builtinTool.execute(input, context)

    if (this.mcpRegistry) {
      return this.mcpRegistry.execute(name, input, context)
    }

    throw new Error(`Tool not found: ${name}`)
  }
}
