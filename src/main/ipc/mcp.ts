// src/main/ipc/mcp.ts —— 入口层：MCP IPC handlers
// 允许依赖：mcp/*、repos/*、shared/*

import { ipcMain } from 'electron'
import { mcpServerRepo, MCPServerType, MCPAuthConfig } from '../repos/mcp-server-repo'
import { mcpRegistry } from '../mcp/client'
import { StdioTransport } from '../mcp/transport/stdio'
import { HttpTransport } from '../mcp/transport/http'
import { MCPServerConfig, MCPTimeoutError } from '../mcp/types'
import type { MCPConnectionTestResult } from '@shared/types/ipc'
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

// Reconcile the running mcpRegistry with the latest DB state for a single
// server. Without this, a server created/edited at runtime stays in DB but is
// never loaded into memory until app restart (connectAllEnabled at startup).
//
// reconnect=true: force disconnect+reconnect on currently-connected servers
//   (use after `update`, so config changes — env / args / url — propagate).
// reconnect=false: only fill the gap between desired and actual state
//   (use after `create` / `setEnabled`).
//
// Failures are logged, not thrown: IPC must succeed regardless — DB is source
// of truth, and the user can re-test or restart to retry the connection.
async function syncRegistry(serverId: string, reconnect: boolean): Promise<void> {
  const server = mcpServerRepo.getById(serverId)
  if (!server) return
  const isConnected = mcpRegistry.getConnectedServers().includes(serverId)

  try {
    if (!server.enabled) {
      if (isConnected) await mcpRegistry.disconnectServer(serverId)
      return
    }
    if (isConnected && reconnect) {
      await mcpRegistry.disconnectServer(serverId)
      await mcpRegistry.connectServer(serverId)
    } else if (!isConnected) {
      await mcpRegistry.connectServer(serverId)
    }
  } catch (err) {
    log.error('[MCP IPC] syncRegistry failed:', serverId, err)
  }
}

/**
 * MCP server 以 name 被 agent 引用、并作为工具注册表的 key,同名会互相覆盖/误删工具,
 * 所以 name 必须唯一。
 */
function assertNameAvailable(name: string, selfId?: string): void {
  const existing = mcpServerRepo.getByName(name)
  if (existing && existing.id !== selfId) {
    throw new Error(`MCP server name already exists: ${name}`)
  }
}

export function registerMCPHandlers(): void {
  ipcMain.handle('mcp:servers:list', () => {
    return mcpServerRepo.list()
  })

  ipcMain.handle('mcp:servers:create', async (_event, input: MCPServerInput) => {
    assertNameAvailable(input.name)
    const server = mcpServerRepo.create({
      name: input.name,
      type: input.type,
      command: input.command,
      args: input.args,
      env: input.env,
      url: input.url,
      auth: input.auth,
      enabled: input.enabled,
    })
    await syncRegistry(server.id, false)
    return server
  })

  ipcMain.handle('mcp:servers:get', (_event, id: string) => {
    const server = mcpServerRepo.getById(id)
    if (!server) {
      throw new Error(`MCP Server not found: ${id}`)
    }
    return server
  })

  ipcMain.handle(
    'mcp:servers:update',
    async (_event, id: string, updates: Partial<MCPServerInput>) => {
      if (updates.name !== undefined) assertNameAvailable(updates.name, id)
      const server = mcpServerRepo.update(id, updates)
      if (!server) {
        throw new Error(`MCP Server not found: ${id}`)
      }
      await syncRegistry(id, true)
      return server
    },
  )

  ipcMain.handle('mcp:servers:delete', async (_event, id: string) => {
    if (mcpRegistry.getConnectedServers().includes(id)) {
      try {
        await mcpRegistry.disconnectServer(id)
      } catch (err) {
        log.error('[MCP IPC] Pre-delete disconnect failed:', id, err)
      }
    }
    mcpServerRepo.delete(id)
  })

  ipcMain.handle('mcp:servers:setEnabled', async (_event, id: string, enabled: boolean) => {
    const server = mcpServerRepo.setEnabled(id, enabled)
    if (!server) {
      throw new Error(`MCP Server not found: ${id}`)
    }
    await syncRegistry(id, false)
    return server
  })

  ipcMain.handle('mcp:servers:importConfig', async (_event, configJson: string) => {
    const config = JSON.parse(configJson)
    const results: Array<{ name: string; status: 'created' | 'updated' }> = []
    const touchedIds: string[] = []

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
      const upserted = mcpServerRepo.upsertFromConfig(name, typedConfig)
      results.push({ name, status })
      touchedIds.push(upserted.id)
    }

    for (const id of touchedIds) {
      await syncRegistry(id, true)
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

  ipcMain.handle(
    'mcp:servers:testConnection',
    async (
      _event,
      server: {
        type: MCPServerType
        command?: string
        args?: string[]
        env?: Record<string, string>
        url?: string
        auth?: MCPAuthConfig
      },
    ): Promise<MCPConnectionTestResult> => {
      const start = Date.now()
      // 测试连接用短超时:设置页需要快速反馈,不沿用 transport 默认的 5 分钟。
      const timeoutMs = 30000
      const isHttp = server.type === 'http' && !!server.url
      const isStdio = server.type === 'stdio' && !!server.command
      if (!isHttp && !isStdio) {
        return {
          status: 'failure',
          error_code: 'INVALID_CONFIG',
          message: '无效的服务器配置',
        }
      }

      const config: MCPServerConfig = {
        id: 'test-' + Date.now(),
        name: 'test',
        type: server.type,
        command: server.command,
        args: server.args || [],
        env: server.env || {},
        url: server.url,
        auth: server.auth,
        enabled: true,
      }
      const transport = isHttp
        ? new HttpTransport(config, timeoutMs)
        : new StdioTransport(config, timeoutMs)

      try {
        await transport.connect()
        const tools = await transport.listTools()
        return {
          status: 'success',
          latency_ms: Date.now() - start,
          tools_count: tools.length,
          message: `✅ 连接成功，发现 ${tools.length} 个工具`,
        }
      } catch (error) {
        log.error('[MCP] Connection test failed:', error)
        const message = error instanceof Error ? error.message : '未知错误'
        if (error instanceof MCPTimeoutError) {
          return {
            status: 'failure',
            error_code: 'TIMEOUT',
            message: `❌ 连接超时（${timeoutMs / 1000}秒），请检查 Server 是否运行`,
          }
        }
        return {
          status: 'failure',
          error_code: 'CONNECTION_FAILED',
          message: `❌ 连接失败：${message}`,
        }
      } finally {
        transport.disconnect()
      }
    },
  )

  ipcMain.handle('mcp:connect', async (_event, serverId: string) => {
    try {
      await mcpRegistry.connectServer(serverId)
      return { status: 'success', message: 'MCP Server connected' }
    } catch (error) {
      log.error('[MCP] Connect failed:', error)
      return {
        status: 'failure',
        error_code: 'CONNECTION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  ipcMain.handle('mcp:disconnect', async (_event, serverId: string) => {
    try {
      await mcpRegistry.disconnectServer(serverId)
      return { status: 'success', message: 'MCP Server disconnected' }
    } catch (error) {
      log.error('[MCP] Disconnect failed:', error)
      return {
        status: 'failure',
        error_code: 'DISCONNECT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  ipcMain.handle('mcp:tools:list', () => {
    return mcpRegistry.listRegisteredTools()
  })

  ipcMain.handle('mcp:servers:connected', () => {
    return mcpRegistry.getConnectedServers()
  })

  ipcMain.handle('mcp:servers:status', () => {
    return mcpRegistry.getAllServerStatus()
  })
}
