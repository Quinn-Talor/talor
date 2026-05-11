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
      'GATEWAY for refreshing your visible MCP (external) tool list. MCP tools ' +
      'cover capabilities that reach outside the local file system / shell on ' +
      'this machine — remote services, external data stores, 3rd-party ' +
      'platforms, live network data, automated browsers, image generation, and ' +
      'similar. Your tool list ALREADY shows the currently visible MCP tools ' +
      'alongside built-in tools; call this tool only when (a) no visible MCP ' +
      'tool matches the user-named target and you suspect one exists, or ' +
      '(b) the MCP section has collapsed since an earlier step and you need it ' +
      'back. After calling, all MCP tools become directly callable in your ' +
      'next step. ' +
      '⛔ NEVER use a local-CLI check (e.g. `which <name>`, `<name> --version`, ' +
      'inspecting installed binaries or running containers) to decide whether ' +
      'a capability is available. A missing local binary does NOT mean the ' +
      'capability is unavailable — it likely lives in an MCP tool. Always scan ' +
      'your MCP tools section (or call this tool to refresh) before declaring ' +
      'something unsupported, asking the user for connection details, or ' +
      'falling back to bash. ' +
      '⛔ NEVER respond with "I will check X" / "I will look up X" / "I will ' +
      'query X" without immediately either (a) dispatching the matching MCP ' +
      'tool, or (b) calling this tool. Saying without calling is a bug — ' +
      'promise then call. ' +
      'Tools you actually invoke remain available for the rest of this turn. ' +
      'Re-call this tool only when you need a different MCP capability you ' +
      'have not yet used.',
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
