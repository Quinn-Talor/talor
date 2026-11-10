// src/main/runtime/mcp-status.ts — 业务层：MCP 服务器的连接状态、工具列表与测试连接
//
// 状态与工具列表读引擎运行时的 MCP 连接池（与运行用同一份连接，规格与目录同源，连接池按规格复用）：
// 运行时还没创建时全部记为未连接，不为读状态而创建运行时；单个服务器等待上限 5 秒，失败只影响它自己。
// 测试连接针对还没保存的表单：凭据库叠一层（表单的临时 id 解析到表单本身），用一次性的连接池建连、
// 列工具，结束后关闭。
//
// 允许依赖: agent-engine、electron-log、runtime/*、repos/mcp-server-repo、accounts/account-store、@shared/types
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import { mcpHost, type McpHost, type McpToolInfo, type Vault } from 'agent-engine'
import { AccountStore } from '../accounts/account-store'
import {
  mcpServerRepo,
  type MCPAuthConfig,
  type MCPServer,
  type MCPServerType,
} from '../repos/mcp-server-repo'
import type { MCPConnectionTestResult } from '@shared/types/ipc'
import { mcpCatalogEntries } from './catalog'
import { getRuntime, runtimeCreated, type Runtime } from './engine'
import { toMcpSpec } from './mcp-spec'
import { createTalorVault, talorVault } from './vault'

/** 读一个服务器状态的等待上限。 */
export const MCP_STATUS_TIMEOUT_MS = 5000
/** 测试连接的等待上限（设置页需要快速反馈）。 */
export const MCP_TEST_TIMEOUT_MS = 30000
/** 引擎连接池在连接等待上限到时抛出的错误消息（agent-engine mcp-host）。 */
const ENGINE_CONNECT_TIMEOUT = '连接超时'

export interface McpServerTools {
  serverId: string
  name: string
  connected: boolean
  tools: McpToolInfo[]
}

export interface McpTestForm {
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  envFromAccount?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
}

const disconnected = (s: MCPServer): McpServerTools => ({
  serverId: s.id,
  name: s.name,
  connected: false,
  tools: [],
})

/** 每个已配置服务器在引擎连接池里的连接状态与工具列表。 */
export async function mcpServerTools(
  deps: { runtime?: () => Runtime | undefined; servers?: () => MCPServer[] } = {},
): Promise<McpServerTools[]> {
  const servers = (deps.servers ?? (() => mcpServerRepo.list()))()
  const runtime = (deps.runtime ?? (() => (runtimeCreated() ? getRuntime() : undefined)))()
  const pool = runtime?.mcp
  if (!pool) return servers.map(disconnected)
  const entries = new Map(mcpCatalogEntries(servers).map((e) => [e.id, e]))
  return Promise.all(
    servers.map(async (server) => {
      const entry = entries.get(server.id)
      if (!server.enabled || !entry) return disconnected(server)
      try {
        const lease = await pool.acquire(entry.spec, {
          vault: runtime.vault ?? talorVault(),
          signal: AbortSignal.timeout(MCP_STATUS_TIMEOUT_MS),
        })
        try {
          return { ...disconnected(server), connected: lease.available(), tools: lease.tools }
        } finally {
          lease.release()
        }
      } catch (err) {
        log.warn('[mcp-status]', server.name, err instanceof Error ? err.message : String(err))
        return disconnected(server)
      }
    }),
  )
}

/** 用还没保存的表单配置建一次性连接并列工具。 */
export async function testMcpConnection(
  form: McpTestForm,
  deps: { host?: (vault: Vault) => McpHost; timeoutMs?: number } = {},
): Promise<MCPConnectionTestResult> {
  const isHttp = form.type === 'http' && !!form.url
  const isStdio = form.type === 'stdio' && !!form.command
  if (!isHttp && !isStdio) {
    return { status: 'failure', error_code: 'INVALID_CONFIG', message: '无效的服务器配置' }
  }
  const now = new Date().toISOString()
  const server: MCPServer = {
    id: `test-${Date.now()}`,
    name: 'test',
    type: form.type,
    command: form.command,
    args: form.args ?? [],
    env: form.env ?? {},
    envFromAccount: form.envFromAccount,
    url: form.url,
    auth: form.auth,
    enabled: true,
    created_at: now,
    updated_at: now,
  }
  const vault = createTalorVault({
    accountValue: (keyName) => AccountStore.getInstance()?.getValue(keyName),
    mcpServer: (id) => (id === server.id ? server : mcpServerRepo.getById(id)),
    envValue: (name) => process.env[name],
  })
  const host = (deps.host ?? ((v) => mcpHost({ vault: v })))(vault)
  const timeoutMs = deps.timeoutMs ?? MCP_TEST_TIMEOUT_MS
  const spec = { ...toMcpSpec(server, 'test')!, connectTimeoutMs: timeoutMs }
  const start = Date.now()
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const lease = await host.acquire(spec, { vault, signal })
    const n = lease.tools.length
    lease.release()
    return {
      status: 'success',
      latency_ms: Date.now() - start,
      tools_count: n,
      message: `✅ 连接成功，发现 ${n} 个工具`,
    }
  } catch (error) {
    log.error('[MCP] Connection test failed:', error)
    const message = error instanceof Error ? error.message : '未知错误'
    // 等待上限到了：我们的 signal 已中止，或连接池自己的连接上限先到（同一时长，引擎报“连接超时”）
    if (signal.aborted || message === ENGINE_CONNECT_TIMEOUT) {
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
    await host.shutdown()
  }
}
