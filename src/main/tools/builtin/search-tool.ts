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
      'GATEWAY to all external (MCP) tools — browser, web search, screenshots, ' +
      'database queries, third-party APIs (GitHub, Slack, Notion, Linear, etc.), ' +
      'fetching live data, navigating webpages, scraping, image generation. ' +
      'You MUST call this tool FIRST whenever the user asks for any of: ' +
      '【浏览器/browser/网页/网址/URL】, 【搜索/search/Google/百度】, ' +
      '【截图/screenshot】, 【实时/股价/新闻/价格/天气/汇率】, ' +
      '【GitHub/Slack/Notion/Linear/Jira/数据库/API】, or anything that requires ' +
      'reaching outside the local file system / shell. ' +
      'These external tools are NOT visible until you call this — your tool list ' +
      'currently only shows local file/shell tools (read/write/edit/bash/glob/grep/ls/skill). ' +
      'After you call this tool, ALL external (MCP) tools become directly callable ' +
      'in your next step (e.g., browser_navigate, browser_screenshot, github_search, etc.). ' +
      '⛔ NEVER respond with "I will use the browser" / "I will search" / "I will check X" ' +
      'WITHOUT calling this tool first — those phrases are signals that you must call ' +
      'this tool RIGHT NOW. Do not promise then stop; promise then call. ' +
      '⛔ NEVER claim a capability is unavailable before calling this tool — the capability ' +
      'is likely behind an MCP server you have not yet discovered. ' +
      'Tools you actually invoke remain available for the rest of this turn. ' +
      'Re-call this tool only when you need a different MCP tool you have not yet used.',
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
