// src/main/mcp/client.ts — 基础设施层：MCP 服务注册中心
//
// McpRegistry — 管理 MCP Server 连接和 Tool 注册。
// 支持多实例：平台 Agent 使用全局共享实例，业务 Agent 创建独立实例。
// MCP Tool 只注册在本实例内部，不注入全局 toolRegistry。
//
// 允许依赖：repos/mcp-server-repo、mcp/transport/*、mcp/types
// 禁止依赖：tools/registry（不注入全局）、ipc/*

import log from 'electron-log'
import { mcpServerRepo, MCPServer, MCPServerType } from '../repos/mcp-server-repo'
import type { ToolExecuteContext, ToolMetadata, ToolErrorEnvelope } from '../tools/types'
import { MCPServerConfig, MCPError, MCPTimeoutError, MCPTool, MCPToolCallResult } from './types'
import { StdioTransport } from './transport/stdio'
import { HttpTransport } from './transport/http'

// 客户端层工具执行超时 5 分钟(与 transport 层默认一致),容纳 akshare 类慢数据源。
const TOOL_TIMEOUT_MS = 300000
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = [1000, 2000, 4000]
const EMPTY_RESULT_TEXT = '(empty result)'

// MCP 工具不参与 HIGH-risk 确认流程：启用一个 MCP server 即视为用户授予该
// server 所有工具的调用权。破坏性保护由后续的 per-workspace 授权系统（bash
// / file 工具）统一处理；此处保持最简。

type McpTransport = StdioTransport | HttpTransport

function configFromServer(server: MCPServer): MCPServerConfig {
  return {
    id: server.id,
    name: server.name,
    type: server.type as MCPServerType,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    auth: server.auth,
    enabled: server.enabled,
  }
}

function createTransport(config: MCPServerConfig): McpTransport {
  return config.type === 'stdio' ? new StdioTransport(config) : new HttpTransport(config)
}

function describeBlock(block: MCPToolCallResult['content'][number]): string {
  switch (block.type) {
    case 'text':
      return block.text ?? ''
    case 'image':
    case 'audio':
      return `[${block.type}: ${block.mimeType ?? 'unknown type'}]`
    case 'resource':
      return block.resource?.text ?? `[resource: ${block.resource?.uri ?? 'unknown uri'}]`
    case 'resource_link':
      return `[resource_link: ${block.uri ?? block.name ?? 'unknown uri'}]`
    default:
      return `[${block.type}]`
  }
}

/**
 * 把 tools/call 结果的全部内容块渲染为文本:text 段原样拼接,非文本段给占位描述。
 * 没有任何文本内容时用 structuredContent 兜底。
 */
export function renderToolResultContent(result: MCPToolCallResult): string {
  const blocks = Array.isArray(result.content) ? result.content : []
  const parts = blocks.map(describeBlock).filter((part) => part.length > 0)
  const hasText = blocks.some(
    (b) => (b.type === 'text' && b.text) || (b.type === 'resource' && b.resource?.text),
  )
  if (!hasText && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent))
  }
  return parts.join('\n')
}

export class McpRegistry {
  private servers = new Map<string, McpTransport>()
  private toolProviders = new Map<
    string,
    {
      listTools(): ToolMetadata[]
      execute(
        toolName: string,
        input: unknown,
        context: ToolExecuteContext,
      ): Promise<{ output: unknown }>
    }
  >()
  private pendingConfigs: MCPServerConfig[] = []
  private lazyConnectDone = false
  // 单飞:同一 server 的并发 connect / reconnect 共享同一个 promise,避免重复 spawn。
  private connecting = new Map<string, Promise<void>>()
  private reconnecting = new Map<string, Promise<McpTransport | null>>()
  // 显式断开时递增;进行中的 connect / reconnect 完成后发现代际变化即丢弃新连接。
  private generations = new Map<string, number>()

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
    await Promise.allSettled(
      configs.map((config) =>
        this.connectWithConfig(config).catch((err) => {
          log.error('[McpRegistry] Lazy connect failed:', config.name, err)
        }),
      ),
    )
  }

  private generationOf(serverId: string): number {
    return this.generations.get(serverId) ?? 0
  }

  private connectWithConfig(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.id)) return Promise.resolve()
    const inFlight = this.connecting.get(config.id)
    if (inFlight) return inFlight
    const promise = this.doConnect(config).finally(() => {
      this.connecting.delete(config.id)
    })
    this.connecting.set(config.id, promise)
    return promise
  }

  private async doConnect(config: MCPServerConfig): Promise<void> {
    const generation = this.generationOf(config.id)
    const transport = createTransport(config)

    let tools: MCPTool[]
    try {
      await transport.connect()
      tools = await transport.listTools()
    } catch (err) {
      log.error('[McpRegistry] Failed to connect server:', config.name, err)
      transport.disconnect()
      throw err
    }

    if (this.generationOf(config.id) !== generation) {
      log.info('[McpRegistry] Server disconnected while connecting, dropping:', config.name)
      transport.disconnect()
      return
    }

    this.servers.set(config.id, transport)
    this.registerTools(config.id, config.name, tools, transport)
    log.info('[McpRegistry] Connected to server:', config.name)
  }

  async connectServer(serverId: string): Promise<void> {
    const server = mcpServerRepo.getById(serverId)
    if (!server) throw new MCPError(`Server not found: ${serverId}`, -32601)
    if (!server.enabled) throw new MCPError(`Server is disabled: ${serverId}`, -32602)
    if (this.servers.has(serverId)) {
      log.info('[McpRegistry] Server already connected:', serverId)
      return
    }
    await this.connectWithConfig(configFromServer(server))
  }

  private reconnect(serverId: string): Promise<McpTransport | null> {
    const inFlight = this.reconnecting.get(serverId)
    if (inFlight) return inFlight
    const promise = this.doReconnect(serverId).finally(() => {
      this.reconnecting.delete(serverId)
    })
    this.reconnecting.set(serverId, promise)
    return promise
  }

  private async doReconnect(serverId: string): Promise<McpTransport | null> {
    const generation = this.generationOf(serverId)
    const isStale = (): boolean => this.generationOf(serverId) !== generation

    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delayMs = RECONNECT_DELAY_MS[attempt] ?? 4000
      log.warn(
        `[McpRegistry] Reconnect attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS} for ${serverId} in ${delayMs}ms`,
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (isStale()) return null

      const server = mcpServerRepo.getById(serverId)
      if (!server || !server.enabled) return null

      const newTransport = createTransport(configFromServer(server))
      try {
        await newTransport.connect()
      } catch (err) {
        log.error(`[McpRegistry] Reconnect attempt ${attempt + 1} failed:`, err)
        newTransport.disconnect()
        continue
      }

      if (isStale()) {
        log.info('[McpRegistry] Server disconnected during reconnect, dropping:', serverId)
        newTransport.disconnect()
        return null
      }

      const previous = this.servers.get(serverId)
      if (previous && previous !== newTransport) previous.disconnect()
      this.servers.set(serverId, newTransport)
      log.info(`[McpRegistry] Reconnected server ${serverId} on attempt ${attempt + 1}`)
      return newTransport
    }
    return null
  }

  private registerTools(
    serverId: string,
    serverName: string,
    tools: MCPTool[],
    transport: McpTransport,
  ): void {
    const self = this
    const provider = {
      name: serverName,
      listTools(): ToolMetadata[] {
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          provider: serverName,
        }))
      },
      async execute(
        toolName: string,
        input: unknown,
        _context: ToolExecuteContext,
      ): Promise<{ output: unknown }> {
        log.info('[McpRegistry] execute called, toolName:', toolName)

        const t = self.servers.get(serverId) ?? transport
        if (!t.isConnected()) {
          log.warn('[McpRegistry] Server disconnected, triggering background reconnect:', serverId)
          self
            .reconnect(serverId)
            .catch((err) => log.error('[McpRegistry] Background reconnect failed:', serverId, err))
          const envelope: ToolErrorEnvelope = {
            __talor_error: true,
            code: 'MCP_DISCONNECTED',
            message: `MCP server "${serverName}" is disconnected.`,
            hint: 'Reconnecting in the background — please retry shortly.',
          }
          return { output: envelope }
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined
        try {
          const result = await Promise.race([
            t.callTool(toolName, input as Record<string, unknown>),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new MCPTimeoutError('Tool execution timed out')),
                TOOL_TIMEOUT_MS,
              )
            }),
          ])

          const text = renderToolResultContent(result)
          if (result.isError) {
            const errorMsg = text || 'Tool execution failed'
            log.error('[McpRegistry] Tool returned error:', errorMsg)
            const envelope: ToolErrorEnvelope = {
              __talor_error: true,
              code: 'MCP_ERROR',
              message: errorMsg,
              hint: 'Check the MCP server log, or retry with different parameters.',
            }
            return { output: envelope }
          }

          return { output: text || EMPTY_RESULT_TEXT }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.error('[McpRegistry] execute error:', errorMsg)
          const isTimeout = err instanceof MCPTimeoutError
          const envelope: ToolErrorEnvelope = {
            __talor_error: true,
            code: isTimeout ? 'MCP_TIMEOUT' : 'MCP_EXCEPTION',
            message: errorMsg,
          }
          return { output: envelope }
        } finally {
          clearTimeout(timeoutId)
        }
      },
    }

    this.toolProviders.set(serverName, provider)
    log.info('[McpRegistry] Registered tools for server:', serverName, tools.length)
  }

  listRegisteredTools(): ToolMetadata[] {
    if (this.pendingConfigs.length > 0 && !this.lazyConnectDone) {
      this.ensureLazyConnect().catch((err) =>
        log.error('[McpRegistry] ensureLazyConnect error:', err),
      )
    }
    const all: ToolMetadata[] = []
    for (const provider of this.toolProviders.values()) {
      all.push(...provider.listTools())
    }
    return all
  }

  async execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<{ output: unknown }> {
    await this.ensureLazyConnect()
    for (const provider of this.toolProviders.values()) {
      const tool = provider.listTools().find((t) => t.name === toolName)
      if (tool) {
        return provider.execute(toolName, input, context)
      }
    }
    throw new MCPError(`MCP tool not found: ${toolName}`, -32601)
  }

  /**
   * 返回受限 McpToolSource — 仅暴露 allowedServerNames 列出的 MCP server 的工具。
   * 用于按 agent.profile.mcpServers (string[]) 过滤平台 mcpRegistry。
   */
  filterByServerNames(allowedServerNames: string[]): {
    listRegisteredTools(): ToolMetadata[]
    execute(
      toolName: string,
      input: unknown,
      context: ToolExecuteContext,
    ): Promise<{ output: unknown }>
  } {
    const allowed = new Set(allowedServerNames)
    const self = this
    return {
      listRegisteredTools(): ToolMetadata[] {
        if (self.pendingConfigs.length > 0 && !self.lazyConnectDone) {
          self
            .ensureLazyConnect()
            .catch((err) => log.error('[McpRegistry] ensureLazyConnect error:', err))
        }
        const out: ToolMetadata[] = []
        for (const [serverName, provider] of self.toolProviders.entries()) {
          if (!allowed.has(serverName)) continue
          out.push(...provider.listTools())
        }
        return out
      },
      async execute(toolName, input, context) {
        await self.ensureLazyConnect()
        for (const [serverName, provider] of self.toolProviders.entries()) {
          if (!allowed.has(serverName)) continue
          const tool = provider.listTools().find((t) => t.name === toolName)
          if (tool) return provider.execute(toolName, input, context)
        }
        throw new MCPError(
          `MCP tool not found in allowed servers [${allowedServerNames.join(', ')}]: ${toolName}`,
          -32601,
        )
      },
    }
  }

  async disconnectServer(serverId: string): Promise<void> {
    this.generations.set(serverId, this.generationOf(serverId) + 1)
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
    await Promise.allSettled(
      servers.map((server) =>
        this.connectServer(server.id).catch((err) => {
          log.error('[McpRegistry] Failed to connect server:', server.name, err)
        }),
      ),
    )
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

  getAllServerStatus(): Array<{
    serverId: string
    name: string
    connected: boolean
    toolCount: number
  }> {
    const servers = mcpServerRepo.list()
    return servers.map((server) => {
      const status = this.getServerStatus(server.id)
      return { serverId: server.id, name: server.name, ...status }
    })
  }
}

// 全局共享实例（平台 Agent 使用）
export const mcpRegistry = new McpRegistry()

// 向后兼容别名
export const mcpClient = mcpRegistry
