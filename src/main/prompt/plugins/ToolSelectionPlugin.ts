// src/main/prompt/plugins/ToolSelectionPlugin.ts —— 业务层：动态工具选择插件
//
// 策略（方案 C "累积可见"）：
//   - 无 MCP 工具：tools = listBuiltinTools（不含 search_tool）
//   - 有 MCP 工具，刚调过 search_tool：tools = base + 全部 MCP（一次性扩展）
//   - 有 MCP 工具，未刚调 search_tool：tools = base + 已用过的 MCP 工具
//   - 有 MCP 工具，未用过任何 MCP：tools = base（含 search_tool）
//
// 信号传递：PipelineContext 提供两个字段（runReactLoop 跨 step 维护）：
//   - mcpExpandThisStep: 仅 search_tool 下一步置 true，一步后归位
//   - usedMcpToolNames: 累积，一旦加入永不移除（本轮内）
//
// 不修改 ToolExecuteContext、不扩展 ToolResult。

import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { ToolMetadata } from '../../tools/types'
import { estimate } from '../../memory/types'

export class ToolSelectionPlugin implements PromptPlugin {
  name = 'ToolSelectionPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.agent) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const baseTools = ctx.agent.toolRegistry.listBuiltinTools()
    const mcpTools = ctx.agent.toolRegistry.listMcpTools()

    if (mcpTools.length === 0) {
      return { messages: [], tools: baseTools, tokenEstimate: this.estimateTools(baseTools) }
    }

    const visibleMcp = ctx.mcpExpandThisStep
      ? mcpTools
      : this.filterByUsed(mcpTools, ctx.usedMcpToolNames ?? [])

    const finalTools: ToolMetadata[] = [...baseTools, ...visibleMcp]

    return {
      messages: [],
      tools: finalTools,
      tokenEstimate: this.estimateTools(finalTools),
    }
  }

  private filterByUsed(mcpTools: ToolMetadata[], used: string[]): ToolMetadata[] {
    if (used.length === 0) return []
    const usedSet = new Set(used)
    return mcpTools.filter((t) => usedSet.has(t.name))
  }

  private estimateTools(tools: ToolMetadata[]): number {
    return tools.reduce((s, t) => s + estimate(t.name + (t.description ?? '')), 0)
  }
}
