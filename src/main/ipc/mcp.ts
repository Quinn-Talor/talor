// src/main/ipc/mcp.ts —— 入口层：MCP IPC handlers
// 导入导出用 Claude Code 的 .mcp.json 格式（{ mcpServers: {…} }，经引擎 parseMcpConfig 解析）；旧格式仍可导入。
// 连接状态与测试连接走引擎的 MCP 连接池（runtime/mcp-status）；增删改与启停只写仓库，运行时按目录里的规格建连。
// 允许依赖：runtime/mcp-status、repos/*、shared/*、agent-engine（parseMcpConfig 与类型）

import { ipcMain } from 'electron'
import { parseMcpConfig, type McpServerSpec, type SecretRef } from '@talor/agent-engine'
import {
  mcpServerRepo,
  MCPServerType,
  MCPAuthConfig,
  type MCPServer,
} from '../repos/mcp-server-repo'
import { mcpServerTools, testMcpConnection, type McpTestForm } from '../runtime/mcp-status'
import type { MCPConnectionTestResult } from '@shared/types/ipc'

export interface MCPServerInput {
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  envFromAccount?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled?: boolean
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
      envFromAccount: input.envFromAccount,
      url: input.url,
      auth: input.auth,
      enabled: input.enabled,
    })
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
      return server
    },
  )

  ipcMain.handle('mcp:servers:delete', async (_event, id: string) => {
    mcpServerRepo.delete(id)
  })

  ipcMain.handle('mcp:servers:setEnabled', async (_event, id: string, enabled: boolean) => {
    const server = mcpServerRepo.setEnabled(id, enabled)
    if (!server) {
      throw new Error(`MCP Server not found: ${id}`)
    }
    return server
  })

  ipcMain.handle('mcp:servers:importConfig', async (_event, configJson: string) => {
    const config = JSON.parse(configJson)
    const results: Array<{ name: string; status: 'created' | 'updated'; warnings?: string[] }> = []

    if (isRecord(config) && isRecord(config.mcpServers)) {
      // 先解析并映射全部服务器，任何一个出错就整体拒绝、不写库
      const mapped = parseMcpConfig(config).map((spec) => ({
        name: spec.name,
        ...mcpServerFromSpec(spec),
      }))
      for (const { name, row, warnings } of mapped) {
        const status = mcpServerRepo.getByName(name) ? 'updated' : 'created'
        mcpServerRepo.upsertFromConfig(name, row)
        results.push({ name, status, ...(warnings.length > 0 ? { warnings } : {}) })
      }
      return results
    }

    for (const [name, serverConfig] of Object.entries(config)) {
      const typedConfig = serverConfig as {
        type: MCPServerType
        command?: string
        args?: string[]
        env?: Record<string, string>
        envFromAccount?: Record<string, string>
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
    return JSON.stringify(dotMcpJsonOf(mcpServerRepo.list()), null, 2)
  })

  ipcMain.handle(
    'mcp:servers:testConnection',
    (_event, server: McpTestForm): Promise<MCPConnectionTestResult> => testMcpConnection(server),
  )

  ipcMain.handle('mcp:servers:status', async () =>
    (await mcpServerTools()).map((s) => ({
      serverId: s.serverId,
      name: s.name,
      connected: s.connected,
      toolCount: s.tools.length,
    })),
  )
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

type ImportedRow = {
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  envFromAccount?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
}

const textOf = (ref: SecretRef) => ref.template ?? `\${${ref.secret}}`

/** .mcp.json 的一个服务器规格 → mcp_servers 的一行；表里放不下的写进 warnings。 */
export function mcpServerFromSpec(spec: McpServerSpec): { row: ImportedRow; warnings: string[] } {
  const warnings: string[] = []
  const t = spec.transport
  if (t.kind === 'stdio') {
    const row: ImportedRow = { type: 'stdio', command: t.command }
    if (t.args && t.args.length > 0) {
      row.args = t.args.map((a, i) => {
        if (typeof a === 'string') return a
        warnings.push(`args[${i}] 的 \${${a.secret}} 不会被解析`)
        return textOf(a)
      })
    }
    const env: Record<string, string> = {}
    const envFromAccount: Record<string, string> = {}
    for (const [k, v] of Object.entries(t.env ?? {})) {
      if (typeof v === 'string') env[k] = v
      else if (v.template === undefined) {
        envFromAccount[k] = v.secret
        warnings.push(
          `env.${k} 改为从账户 key ${v.secret} 取值，不读进程环境变量（Claude Code 读进程环境变量）`,
        )
      } else {
        env[k] = v.template
        warnings.push(`env.${k} 的模板不会被解析`)
      }
    }
    if (Object.keys(env).length > 0) row.env = env
    if (Object.keys(envFromAccount).length > 0) row.envFromAccount = envFromAccount
    if (t.cwd !== undefined) warnings.push('cwd 不支持，已忽略')
    return { row, warnings }
  }
  const row: ImportedRow = { type: 'http', url: t.url }
  for (const [k, v] of Object.entries(t.headers ?? {})) {
    const key = k.toLowerCase()
    if (key === 'authorization' && typeof v === 'string' && v.startsWith('Bearer ')) {
      row.auth = { type: 'bearer', token: v.slice('Bearer '.length) }
    } else if (key === 'x-api-key' && typeof v === 'string') {
      row.auth = { type: 'apiKey', apiKey: v }
    } else {
      warnings.push(`请求头 ${k} 不支持，已忽略`)
    }
  }
  return { row, warnings }
}

/** mcp_servers → .mcp.json（含停用的服务器；账户凭据引用导出为 `${<账户 key>}`）。 */
export function dotMcpJsonOf(servers: MCPServer[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    if (s.type === 'stdio') {
      const env: Record<string, string> = { ...s.env }
      for (const [k, key] of Object.entries(s.envFromAccount ?? {})) env[k] = `\${${key}}`
      mcpServers[s.name] = {
        command: s.command,
        ...(s.args && s.args.length > 0 ? { args: s.args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      }
    } else {
      const headers =
        s.auth?.type === 'bearer' && s.auth.token
          ? { Authorization: `Bearer ${s.auth.token}` }
          : s.auth?.type === 'apiKey' && s.auth.apiKey
            ? { 'X-API-Key': s.auth.apiKey }
            : undefined
      mcpServers[s.name] = { type: 'http', url: s.url, ...(headers ? { headers } : {}) }
    }
  }
  return { mcpServers }
}
