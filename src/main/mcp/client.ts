import log from 'electron-log'
import { mcpServerRepo, MCPServerType } from '../repos/mcp-server-repo'
import { toolRegistry, type ToolExecuteContext, type ToolMetadata } from '../tools/registry'
import { MCPServerConfig, MCPError } from './types'
import { StdioTransport } from './transport/stdio'
import { HttpTransport } from './transport/http'

const TOOL_TIMEOUT_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = [1000, 2000, 4000]

class MCPClientImpl {
  private servers = new Map<string, StdioTransport | HttpTransport>()
  private toolProviders = new Map<string, {
    listTools(): ToolMetadata[]
    execute(toolName: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }>
  }>()

  async connectServer(serverId: string): Promise<void> {
    const server = mcpServerRepo.getById(serverId)
    if (!server) {
      throw new MCPError(`Server not found: ${serverId}`, -32601)
    }

    if (!server.enabled) {
      throw new MCPError(`Server is disabled: ${serverId}`, -32602)
    }

    if (this.servers.has(serverId)) {
      log.info('[MCPClient] Server already connected:', serverId)
      return
    }

    const config: MCPServerConfig = {
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

    let transport: StdioTransport | HttpTransport
    if (server.type === 'stdio') {
      transport = new StdioTransport(config)
    } else {
      transport = new HttpTransport(config)
    }

    try {
      await transport.connect()
      this.servers.set(serverId, transport)
      log.info('[MCPClient] Connected to server:', server.name)

      await this.registerTools(serverId, transport)
    } catch (err) {
      log.error('[MCPClient] Failed to connect server:', server.name, err)
      throw err
    }
  }

  private async reconnect(serverId: string): Promise<StdioTransport | HttpTransport | null> {
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delayMs = RECONNECT_DELAY_MS[attempt] ?? 4000
      log.warn(`[MCPClient] Reconnect attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS} for ${serverId} in ${delayMs}ms`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      try {
        const server = mcpServerRepo.getById(serverId)
        if (!server) return null
        const config: MCPServerConfig = {
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
        const newTransport: StdioTransport | HttpTransport = server.type === 'stdio'
          ? new StdioTransport(config)
          : new HttpTransport(config)
        await newTransport.connect()
        this.servers.set(serverId, newTransport)
        log.info(`[MCPClient] Reconnected server ${serverId} on attempt ${attempt + 1}`)
        return newTransport
      } catch (err) {
        log.error(`[MCPClient] Reconnect attempt ${attempt + 1} failed:`, err)
      }
    }
    return null
  }

  private async registerTools(serverId: string, transport: StdioTransport | HttpTransport): Promise<void> {
    const tools = await transport.listTools()
    const serverConfig = transport.serverConfig
    const serverName = serverConfig.name

    const self = this
    const provider = {
      name: serverName,
      listTools(): ToolMetadata[] {
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        }))
      },
      async execute(
        toolName: string,
        input: unknown,
        _context: ToolExecuteContext
      ): Promise<{ output: unknown }> {
        log.info('[MCPClient] execute called, toolName:', toolName)

        let t = self.servers.get(serverId) ?? transport
        if (!t.isConnected()) {
          log.warn('[MCPClient] Server disconnected, attempting reconnect:', serverId)
          const reconnected = await self.reconnect(serverId)
          if (!reconnected) {
            log.error('[MCPClient] All reconnect attempts failed for:', serverId)
            return { output: '错误：MCP 服务器重连失败，请检查服务器配置。' }
          }
          t = reconnected
        }

        try {
          log.info('[MCPClient] Calling tool via transport...')
          const result = await Promise.race([
            t.callTool(toolName, input as Record<string, unknown>),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new MCPError('Tool execution timed out', -32603)), TOOL_TIMEOUT_MS)
            ),
          ])

          if ('isError' in result && result.isError) {
            const errorMsg = result.content[0]?.text || 'Tool execution failed'
            log.error('[MCPClient] Tool returned error:', errorMsg)
            return { output: `工具执行出错：${errorMsg}` }
          }

          log.info('[MCPClient] Tool result received, content:', JSON.stringify(result.content).slice(0, 200))
          const outputText = result.content[0]?.text || ''
          if (!outputText) {
            log.warn('[MCPClient] Tool returned empty output')
            return { output: '工具返回空结果，可能浏览器会话已过期。' }
          }
          return { output: outputText }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.error('[MCPClient] execute error:', errorMsg)
          return { output: `工具执行异常：${errorMsg}` }
        }
      },
    }

    this.toolProviders.set(serverName, provider)
    toolRegistry.registerExternalProvider(provider)
    log.info('[MCPClient] Registered tools for server:', serverName, tools.length)
  }

  async disconnectServer(serverId: string): Promise<void> {
    const transport = this.servers.get(serverId)
    if (!transport) {
      return
    }

    const server = mcpServerRepo.getById(serverId)
    if (server) {
      toolRegistry.unregisterExternalProvider(server.name)
      this.toolProviders.delete(server.name)
    }

    transport.disconnect()
    this.servers.delete(serverId)
    log.info('[MCPClient] Disconnected server:', serverId)
  }

  async connectAllEnabled(): Promise<void> {
    const servers = mcpServerRepo.list().filter((s) => s.enabled)
    for (const server of servers) {
      try {
        await this.connectServer(server.id)
      } catch (err) {
        log.error('[MCPClient] Failed to connect server:', server.name, err)
      }
    }
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys())
  }

  getServerStatus(serverId: string): { connected: boolean; toolCount: number } {
    const transport = this.servers.get(serverId)
    if (!transport) {
      return { connected: false, toolCount: 0 }
    }
    const provider = this.toolProviders.get(transport.serverConfig.name)
    return {
      connected: true,
      toolCount: provider?.listTools().length ?? 0,
    }
  }

  getAllServerStatus(): Array<{ serverId: string; name: string; connected: boolean; toolCount: number }> {
    const result: Array<{ serverId: string; name: string; connected: boolean; toolCount: number }> = []
    const servers = mcpServerRepo.list()
    for (const server of servers) {
      const status = this.getServerStatus(server.id)
      result.push({
        serverId: server.id,
        name: server.name,
        connected: status.connected,
        toolCount: status.toolCount,
      })
    }
    return result
  }
}

export const mcpClient = new MCPClientImpl()
