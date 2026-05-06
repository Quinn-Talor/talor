// src/main/tools/builtin/search-tool.ts — 业务层：MCP 工具按需加载触发器
//
// search_tool 是无参工具，存在意义是触发 ReAct 循环把 MCP 工具注入下一步的
// tools 参数。本身不修改任何 state——信号通过"上一步 toolName === 'search_tool'"
// 显式数据流传递（见 ToolSelectionPlugin）。
//
// 工厂函数模式：与 createSkillTool 同。Agent 构造时调用 createSearchTool(mcpRegistry)
// 加入 agentTools，不进 BuiltinToolRegistry。
//
// 允许依赖：tools/types、agent/agent-toolset（McpToolSource 类型）
// 禁止依赖：ipc/*

import log from 'electron-log'
import type { ToolDefinition, ToolErrorEnvelope, ToolMetadata } from '../types'
import type { McpToolSource } from '../../agent/agent-toolset'

function buildEnvelope(code: string, message: string): ToolErrorEnvelope {
  return { __talor_error: true, code, message }
}

function listToolsAndServers(mcpSource: McpToolSource): {
  tools: ToolMetadata[]
  servers: string[]
} {
  const tools = mcpSource.listRegisteredTools()
  const seen = new Set<string>()
  const servers: string[] = []
  for (const t of tools) {
    const provider = typeof t.provider === 'string' ? t.provider : null
    if (provider && !seen.has(provider)) {
      seen.add(provider)
      servers.push(provider)
    }
  }
  return { tools, servers }
}

export function createSearchTool(mcpSource: McpToolSource | null): ToolDefinition {
  return {
    name: 'search_tool',
    description:
      'Discover available external (MCP) tools. ' +
      'Call this when you need capabilities beyond the built-in tools ' +
      '(read/write/edit/bash/glob/grep/ls), e.g., sending messages, querying APIs, ' +
      'interacting with third-party services. ' +
      'After calling, ALL MCP tools become directly callable in your next step. ' +
      'Tools you actually invoke remain available for the rest of this turn ' +
      '(no need to re-search to reuse them). ' +
      'Re-call this tool when you need a different MCP tool you have not yet used.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    riskLevel: 'LOW',

    execute: async () => {
      if (!mcpSource) {
        return {
          output: buildEnvelope(
            'MCP_REGISTRY_MISSING',
            'MCP registry not configured for this agent.',
          ),
        }
      }

      let tools: ToolMetadata[]
      let servers: string[]
      try {
        const result = listToolsAndServers(mcpSource)
        tools = result.tools
        servers = result.servers
      } catch (err) {
        log.error('[SearchTool] listRegisteredTools failed:', err)
        return {
          output: buildEnvelope(
            'MCP_LIST_FAILED',
            `Failed to list MCP tools: ${err instanceof Error ? err.message : String(err)}`,
          ),
        }
      }

      if (tools.length === 0) {
        return { output: 'No MCP tools currently available.' }
      }

      const serverList = servers.length > 0 ? servers.join(', ') : 'unknown'
      return {
        output:
          `Loaded ${tools.length} MCP tools from: ${serverList}.\n` +
          `These tools are now available in your tool set—use them directly.`,
      }
    },
  }
}
