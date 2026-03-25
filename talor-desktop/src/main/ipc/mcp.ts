import { ipcMain } from 'electron'
import { mcpServerRepo, MCPServerType, MCPAuthConfig } from '../repos/mcp-server-repo'
import log from 'electron-log'

export interface MCPServerInput {
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled?: boolean
}

export function registerMCPHandlers(): void {
  ipcMain.handle('mcp:servers:list', () => {
    return mcpServerRepo.list()
  })

  ipcMain.handle('mcp:servers:create', (_event, input: MCPServerInput) => {
    return mcpServerRepo.create({
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      env: input.env,
      url: input.url,
      auth: input.auth,
    })
  })

  ipcMain.handle('mcp:servers:get', (_event, id: string) => {
    const server = mcpServerRepo.getById(id)
    if (!server) {
      throw new Error(`MCP Server not found: ${id}`)
    }
    return server
  })

  ipcMain.handle('mcp:servers:update', (_event, id: string, updates: Partial<MCPServerInput>) => {
    const server = mcpServerRepo.update(id, updates)
    if (!server) {
      throw new Error(`MCP Server not found: ${id}`)
    }
    return server
  })

  ipcMain.handle('mcp:servers:delete', (_event, id: string) => {
    mcpServerRepo.delete(id)
  })

  ipcMain.handle('mcp:servers:setEnabled', (_event, id: string, enabled: boolean) => {
    const server = mcpServerRepo.setEnabled(id, enabled)
    if (!server) {
      throw new Error(`MCP Server not found: ${id}`)
    }
    return server
  })

  ipcMain.handle('mcp:servers:importConfig', (_event, configJson: string) => {
    const config = JSON.parse(configJson)
    const results: Array<{ name: string; status: 'created' | 'updated' }> = []

    for (const [name, serverConfig] of Object.entries(config)) {
      const typedConfig = serverConfig as {
        type: MCPServerType
        command?: string
        args?: string[]
        env?: Record<string, string>
        url?: string
        auth?: MCPAuthConfig
      }
      const existing = mcpServerRepo.getByName(name)
      const status = existing ? 'updated' : 'created'
      mcpServerRepo.upsertFromConfig(name, typedConfig)
      results.push({ name, status })
    }

    return results
  })

  ipcMain.handle('mcp:servers:exportConfig', () => {
    const servers = mcpServerRepo.list()
    const config: Record<string, unknown> = {}

    for (const server of servers) {
      config[server.name] = {
        type: server.type,
        ...(server.command && { command: server.command }),
        ...(server.args && { args: server.args }),
        ...(server.env && { env: server.env }),
        ...(server.url && { url: server.url }),
        ...(server.auth && { auth: server.auth }),
      }
    }

    return JSON.stringify(config, null, 2)
  })

  ipcMain.handle('mcp:servers:testConnection', async (_event, server: {
    type: MCPServerType
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    auth?: MCPAuthConfig
  }) => {
    const start = Date.now()
    const timeout = 30000

    try {
      if (server.type === 'http' && server.url) {
        const headers: Record<string, string> = {}
        if (server.auth) {
          if (server.auth.type === 'bearer' && server.auth.token) {
            headers['Authorization'] = `Bearer ${server.auth.token}`
          } else if (server.auth.type === 'apiKey' && server.auth.apiKey) {
            headers['X-API-Key'] = server.auth.apiKey
          }
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        try {
          const response = await fetch(server.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list'
            }),
            signal: controller.signal
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            return {
              status: 'failure',
              error_code: 'CONNECTION_FAILED',
              message: `HTTP ${response.status}: ${response.statusText}`
            }
          }

          const data = await response.json() as { result?: { tools?: Array<{ name: string }> } }
          const toolsCount = data.result?.tools?.length ?? 0

          return {
            status: 'success',
            latency_ms: Date.now() - start,
            tools_count: toolsCount,
            message: `✅ 连接成功，发现 ${toolsCount} 个工具`
          }
        } catch (httpError) {
          clearTimeout(timeoutId)
          if (httpError instanceof Error && httpError.name === 'AbortError') {
            return {
              status: 'failure',
              error_code: 'TIMEOUT',
              message: `❌ 连接超时（${timeout / 1000}秒），请检查 Server 是否运行`
            }
          }
          throw httpError
        }
      }

      if (server.type === 'stdio' && server.command) {
        return {
          status: 'success',
          latency_ms: Date.now() - start,
          tools_count: 0,
          message: 'STDIO 模式连接测试需要启动进程（暂仅支持 HTTP）'
        }
      }

      return {
        status: 'failure',
        error_code: 'INVALID_CONFIG',
        message: '无效的服务器配置'
      }
    } catch (error) {
      log.error('[MCP] Connection test failed:', error)
      return {
        status: 'failure',
        error_code: 'CONNECTION_FAILED',
        message: `❌ 连接失败：${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  })
}
