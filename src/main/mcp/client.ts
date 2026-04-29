// src/main/mcp/client.ts — 基础设施层：MCP 服务注册中心
//
// McpRegistry — 管理 MCP Server 连接和 Tool 注册。
// 支持多实例：平台 Agent 使用全局共享实例，业务 Agent 创建独立实例。
// MCP Tool 只注册在本实例内部，不注入全局 toolRegistry。
//
// 允许依赖：repos/mcp-server-repo、mcp/transport/*、mcp/types
// 禁止依赖：tools/registry（不注入全局）、ipc/*

import log from 'electron-log'
import { mcpServerRepo, MCPServerType } from '../repos/mcp-server-repo'
import { ConfigStore } from '../store/config-store'
import type { ToolExecuteContext, ToolMetadata } from '../tools/types'
import { MCPServerConfig, MCPError } from './types'
import { StdioTransport } from './transport/stdio'
import { HttpTransport } from './transport/http'

const TOOL_TIMEOUT_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = [1000, 2000, 4000]

/**
 * 命中这些 pattern 的 MCP 工具按 LOW 风险处理（无需确认）。
 * 未命中且未在 server.lowRiskTools 白名单里的，统一按 HIGH —— 保守默认。
 *
 * 为什么保守：MCP 里 `send_*` / `delete_*` / `create_*` 是常见高破坏力操作，
 * 历史实现 riskLevel=undefined → 全部跳过确认，这是高危口子。反转默认值
 * 让"只读意图"必须被显式标注才能无感调用。
 */
const READ_ONLY_PATTERNS: RegExp[] = [
  /^(get|list|search|query|find|read|fetch|show|describe|lookup|count|view|check|test|ping|head)([-_A-Z]|$)/i,
]

function isLegacyAutoApprove(): boolean {
  try {
    return ConfigStore.getInstance().get('mcp_legacy_auto_approve') === true
  } catch {
    return false
  }
}

function inferMcpRiskLevel(toolName: string, lowRiskOverrides: string[] | undefined): 'HIGH' | 'LOW' {
  if (isLegacyAutoApprove()) return 'LOW'
  if (lowRiskOverrides?.includes(toolName)) return 'LOW'
  if (READ_ONLY_PATTERNS.some(re => re.test(toolName))) return 'LOW'
  return 'HIGH'
}

export class McpRegistry {
  private servers = new Map<string, StdioTransport | HttpTransport>()
  private toolProviders = new Map<string, {
    listTools(): ToolMetadata[]
    execute(toolName: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }>
  }>()
  private pendingConfigs: MCPServerConfig[] = []
  private lazyConnectDone = false

  addPendingConfig(config: MCPServerConfig): void {
    this.pendingConfigs.push(config)
  }

  private lazyConnectPromise: Promise<void> | null = null

  private ensureLazyConnect(): Promise<void> {
    if (this.lazyConnectDone || this.pendingConfigs.length === 0) return Promise.resolve()
    if (this.lazyConnectPromise) return this.lazyConnectPromise
    this.lazyConnectPromise = this.doLazyConnect()
    return this.lazyConnectPromise
  }

  private async doLazyConnect(): Promise<void> {
    this.lazyConnectDone = true
    const configs = [...this.pendingConfigs]
    this.pendingConfigs = []
    for (const config of configs) {
      try {
        await this.connectWithConfig(config)
      } catch (err) {
        log.error('[McpRegistry] Lazy connect failed:', config.name, err)
      }
    }
  }

  private async connectWithConfig(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.id)) return

    const transport: StdioTransport | HttpTransport = config.type === 'stdio'
      ? new StdioTransport(config)
      : new HttpTransport(config)

    try {
      await transport.connect()
      this.servers.set(config.id, transport)
      log.info('[McpRegistry] Connected to server:', config.name)
      await this.registerTools(config.id, transport)
    } catch (err) {
      log.error('[McpRegistry] Failed to connect server:', config.name, err)
      throw err
    }
  }

  async connectServer(serverId: string): Promise<void> {
    const server = mcpServerRepo.getById(serverId)
    if (!server) throw new MCPError(`Server not found: ${serverId}`, -32601)
    if (!server.enabled) throw new MCPError(`Server is disabled: ${serverId}`, -32602)
    if (this.servers.has(serverId)) {
      log.info('[McpRegistry] Server already connected:', serverId)
      return
    }

    const config: MCPServerConfig = {
      id: server.id, name: server.name, type: server.type as MCPServerType,
      command: server.command, args: server.args, env: server.env,
      url: server.url, auth: server.auth, enabled: server.enabled,
    }
    await this.connectWithConfig(config)
  }

  private async reconnect(serverId: string): Promise<StdioTransport | HttpTransport | null> {
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delayMs = RECONNECT_DELAY_MS[attempt] ?? 4000
      log.warn(`[McpRegistry] Reconnect attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS} for ${serverId} in ${delayMs}ms`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      try {
        const server = mcpServerRepo.getById(serverId)
        if (!server) return null
        const config: MCPServerConfig = {
          id: server.id, name: server.name, type: server.type as MCPServerType,
          command: server.command, args: server.args, env: server.env,
          url: server.url, auth: server.auth, enabled: server.enabled,
        }
        const newTransport: StdioTransport | HttpTransport = server.type === 'stdio'
          ? new StdioTransport(config)
          : new HttpTransport(config)
        await newTransport.connect()
        this.servers.set(serverId, newTransport)
        log.info(`[McpRegistry] Reconnected server ${serverId} on attempt ${attempt + 1}`)
        return newTransport
      } catch (err) {
        log.error(`[McpRegistry] Reconnect attempt ${attempt + 1} failed:`, err)
      }
    }
    return null
  }

  private async registerTools(serverId: string, transport: StdioTransport | HttpTransport): Promise<void> {
    const tools = await transport.listTools()
    const serverConfig = transport.serverConfig
    const serverName = serverConfig.name

    const self = this
    const lowRiskOverrides = serverConfig.lowRiskTools
    const provider = {
      name: serverName,
      listTools(): ToolMetadata[] {
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          provider: serverName,
          riskLevel: inferMcpRiskLevel(tool.name, lowRiskOverrides),
        }))
      },
      async execute(
        toolName: string,
        input: unknown,
        _context: ToolExecuteContext
      ): Promise<{ output: unknown }> {
        log.info('[McpRegistry] execute called, toolName:', toolName)

        const t = self.servers.get(serverId) ?? transport
        if (!t.isConnected()) {
          log.warn('[McpRegistry] Server disconnected, triggering background reconnect:', serverId)
          self.reconnect(serverId).catch(err =>
            log.error('[McpRegistry] Background reconnect failed:', serverId, err))
          return { output: `MCP server "${serverName}" is disconnected. Reconnecting in the background — please retry shortly.` }
        }

        try {
          const result = await Promise.race([
            t.callTool(toolName, input as Record<string, unknown>),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new MCPError('Tool execution timed out', -32603)), TOOL_TIMEOUT_MS)
            ),
          ])

          if ('isError' in result && result.isError) {
            const errorMsg = result.content[0]?.text || 'Tool execution failed'
            log.error('[McpRegistry] Tool returned error:', errorMsg)
            return { output: `Tool execution error: ${errorMsg}` }
          }

          const outputText = result.content[0]?.text || ''
          if (!outputText) {
            return { output: 'Tool returned an empty result. The underlying session may have expired.' }
          }
          return { output: outputText }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.error('[McpRegistry] execute error:', errorMsg)
          return { output: `Tool execution exception: ${errorMsg}` }
        }
      },
    }

    this.toolProviders.set(serverName, provider)
    log.info('[McpRegistry] Registered tools for server:', serverName, tools.length)
  }

  listRegisteredTools(): ToolMetadata[] {
    if (this.pendingConfigs.length > 0 && !this.lazyConnectDone) {
      this.ensureLazyConnect().catch(err => log.error('[McpRegistry] ensureLazyConnect error:', err))
    }
    const all: ToolMetadata[] = []
    for (const provider of this.toolProviders.values()) {
      all.push(...provider.listTools())
    }
    return all
  }

  async execute(toolName: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    await this.ensureLazyConnect()
    for (const provider of this.toolProviders.values()) {
      const tool = provider.listTools().find(t => t.name === toolName)
      if (tool) {
        return provider.execute(toolName, input, context)
      }
    }
    throw new MCPError(`MCP tool not found: ${toolName}`, -32601)
  }

  async disconnectServer(serverId: string): Promise<void> {
    const transport = this.servers.get(serverId)
    if (!transport) return

    const serverName = transport.serverConfig.name
    this.toolProviders.delete(serverName)
    transport.disconnect()
    this.servers.delete(serverId)
    log.info('[McpRegistry] Disconnected server:', serverId)
  }

  async connectAllEnabled(): Promise<void> {
    const servers = mcpServerRepo.list().filter((s) => s.enabled)
    for (const server of servers) {
      try {
        await this.connectServer(server.id)
      } catch (err) {
        log.error('[McpRegistry] Failed to connect server:', server.name, err)
      }
    }
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys())
  }

  getServerStatus(serverId: string): { connected: boolean; toolCount: number } {
    const transport = this.servers.get(serverId)
    if (!transport) return { connected: false, toolCount: 0 }
    const provider = this.toolProviders.get(transport.serverConfig.name)
    return { connected: true, toolCount: provider?.listTools().length ?? 0 }
  }

  getAllServerStatus(): Array<{ serverId: string; name: string; connected: boolean; toolCount: number }> {
    const servers = mcpServerRepo.list()
    return servers.map(server => {
      const status = this.getServerStatus(server.id)
      return { serverId: server.id, name: server.name, ...status }
    })
  }
}

// 全局共享实例（平台 Agent 使用）
export const mcpRegistry = new McpRegistry()

// 向后兼容别名
export const mcpClient = mcpRegistry
