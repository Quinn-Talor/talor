// src/main/agent/tool-registry.ts — 业务层：Agent 的工具注册中心
//
// 组合 BuiltinToolRegistry + Agent 专属工具 + MCP tools → 白名单过滤。
// 对外提供 listBuiltinTools() / listMcpTools() / listTools() / execute()。
// 每个 Agent 实例持有独立的 ToolRegistry，构造后只读，线程安全。
//
// 关键概念区分：
//   1. "工具已注册"（execute 时能找到）vs "工具对 LLM 暴露"（出现在 listTools）
//      —— 不同 Agent 注册的工具集相同（共享 BuiltinToolRegistry），但暴露给 LLM
//      的子集可以不同。后者由 allowedTools + ALWAYS_AVAILABLE_TOOLS 决策。
//   2. 平台 Agent（__chat__ / __crystallizer__）：allowedTools.size === 0，不过滤，
//      所有已注册工具都暴露。
//   3. 业务 Agent（如 sales-analyst）：profile.dependencies.tools 显式声明白名单，
//      此时仅"白名单 ∪ ALWAYS_AVAILABLE_TOOLS"对 LLM 暴露，详见 ALWAYS_AVAILABLE_TOOLS 注释。
//
// search_tool 处理：Agent 构造时按需注入到 agentTools。本 registry 在 mcpRegistry
// 无任何工具时主动从 listBuiltinTools 输出中过滤掉，避免暴露一个永远返回
// "No MCP tools available" 的死工具。

import type { ToolMetadata, ToolDefinition, ToolExecuteContext } from '../tools/types'
import type { BuiltinToolRegistry } from './builtin-registry'

/**
 * 白名单豁免集——这些工具即便不在 Agent 的 `profile.dependencies.tools` 显式声明，
 * 也始终对 LLM 暴露。
 *
 * 设计原则：**最小权限 + 安全基础底座**。
 *
 * 业务 Agent（如"销售分析师"）通过 profile.dependencies.tools 声明它需要的工具
 * （比如只声明 ['bash']）。如果严格执行白名单，Agent 会丧失最基本的"看一眼环境"
 * 能力（read / ls / glob / grep）——任何 Agent 几乎都需要这些来理解上下文。
 * 所以本集合定义了一个"豁免基础底座"，所有 Agent 自动获得，无需显式声明。
 *
 * 选入标准（保守）：
 *   - 只读探查类（read / ls / glob / grep）：副作用为零，无安全风险
 *   - 元工具（skill / search_tool）：仅加载/发现，不直接动数据
 *
 * 故意排除：
 *   - write / edit：写文件，必须显式声明
 *   - bash：执行任意命令，最高风险
 *   - delegate_agent：调度其他 Agent，权责重
 *   - MCP 工具：走 search_tool 按需加载，或显式 allowlist
 *
 * 注意：ALWAYS_AVAILABLE_TOOLS 是"豁免白名单"，不等于"必然存在"。如果 Agent
 * 没有注入对应工具（比如 skillRegistry 为空时不注入 skill 工具），它仍不在
 * 最终 tools 列表里。本集合只在 applyAllowlist filter 时绕开 allowlist 检查。
 *
 * 平台 Agent（__chat__ / __crystallizer__）的 allowedTools 为空集，本豁免逻辑
 * 不生效——平台 Agent 默认全部可用，反而是业务 Agent 才需要这层豁免。
 */
export const ALWAYS_AVAILABLE_TOOLS = new Set([
  'read',
  'ls',
  'glob',
  'grep',
  'skill',
  'search_tool',
])

export interface McpToolSource {
  listRegisteredTools(): ToolMetadata[]
  execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<{ output: unknown }>
}

function toMetadata(t: ToolDefinition): ToolMetadata {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    schema: t.schema,
    riskLevel: t.riskLevel,
  }
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

  /**
   * 固定工具集：内置工具 + agent 专属工具（含 skill / search_tool）。
   * 当 mcpRegistry 无任何工具时，过滤掉 search_tool（暴露它没有意义）。
   */
  listBuiltinTools(): ToolMetadata[] {
    const builtinTools = this.builtinRegistry.listAll()
    const agentTools = Array.from(this.agentToolMap.values()).map(toMetadata)
    let combined: ToolMetadata[] = [...builtinTools, ...agentTools]

    const mcpCount = this.mcpRegistry?.listRegisteredTools().length ?? 0
    if (mcpCount === 0) {
      combined = combined.filter((t) => t.name !== 'search_tool')
    }

    return this.applyAllowlist(combined)
  }

  /** 仅 MCP 工具。受 allowedTools 白名单约束。 */
  listMcpTools(): ToolMetadata[] {
    const mcpTools = this.mcpRegistry?.listRegisteredTools() ?? []
    return this.applyAllowlist(mcpTools)
  }

  /** 兼容方法：listBuiltinTools + listMcpTools 合集。 */
  listTools(): ToolMetadata[] {
    return [...this.listBuiltinTools(), ...this.listMcpTools()]
  }

  private applyAllowlist(tools: ToolMetadata[]): ToolMetadata[] {
    if (this.allowedTools.size === 0) return tools
    return tools.filter((t) => this.allowedTools.has(t.name) || ALWAYS_AVAILABLE_TOOLS.has(t.name))
  }

  getToolNames(): string[] {
    return this.listTools().map((t) => t.name)
  }

  hasTool(name: string): boolean {
    return this.listTools().some((t) => t.name === name)
  }

  getBuiltinTool(name: string): ToolDefinition | undefined {
    return this.builtinRegistry.getTool(name)
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<{ output: unknown }> {
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
