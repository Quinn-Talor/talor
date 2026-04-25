import log from 'electron-log'
import { mcpServerRepo, MCPServer, MCPServerType } from '../repos/mcp-server-repo'
import { toolRegistry, type ToolExecuteContext, type ToolMetadata } from '../tools/registry'
import { MCPServerConfig, MCPError } from './types'
import { StdioTransport } from './transport/stdio'
import { HttpTransport } from './transport/http'

const TOOL_TIMEOUT_MS = 30000

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

  private async registerTools(serverId: string, transport: StdioTransport | HttpTransport): Promise<void> {
    const tools = await transport.listTools()
    const serverConfig = transport instanceof StdioTransport 
      ? (transport as StdioTransport).serverConfig
      : (transport as HttpTransport).serverConfig
    const serverName = serverConfig.name

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
        context: ToolExecuteContext
      ): Promise<{ output: unknown }> {
        log.info('[MCPClient] execute called, toolName:', toolName)
        
        const t = transport as StdioTransport | HttpTransport
        if (!t.isConnected()) {
          log.error('[MCPClient] Server not connected!')
          return { output: '错误：MCP 服务器未连接。请重启应用。' }
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