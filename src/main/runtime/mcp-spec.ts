// src/main/runtime/mcp-spec.ts — 业务层：MCP 服务器配置 → agent-engine 的 McpServerSpec
//
// slug 是服务器在模型面前的前缀（工具名 `<slug>__<工具名>`），由服务器名规整而来、保证唯一，
// 每次由服务器列表计算（能力架构方案 §3.2）。规格里的凭据全部是引用，由 TalorVault 在建连时解析，
// 规格本身进入 Agent 指纹，不含凭据值（方案 §3.3）。超时与旧路径对齐：首次 `npx -y` 要下载，
// 建连给 60 秒；工具调用 300 秒，同 mcp/client.ts 的 TOOL_TIMEOUT_MS。
//
// 允许依赖: agent-engine（类型）、repos/mcp-server-repo（类型）、runtime/vault
// 禁止依赖: ipc/*、db/*

import type { McpServerSpec, SecretRef } from '@talor/agent-engine'
import type { MCPServer } from '../repos/mcp-server-repo'
import { accountSecret, mcpAuthSecret } from './vault'

const MAX_SLUG_LENGTH = 32
const CONNECT_TIMEOUT_MS = 60_000
const CALL_TIMEOUT_MS = 300_000

function trimEnds(s: string): string {
  return s.replace(/^[_-]+|[_-]+$/g, '')
}

/** 名字规整成前缀：只留 `[A-Za-z0-9_-]`，不连续下划线，最长 32 个字符，空时为 `mcp`。 */
export function slugBase(name: string): string {
  const normalized = trimEnds(name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_'))
  return trimEnds(normalized.slice(0, MAX_SLUG_LENGTH)) || 'mcp'
}

/** 服务器 id → slug。按创建时间、再按 id 排序，重名的从 `_2` 起加序号。 */
export function mcpSlugs(
  servers: Array<Pick<MCPServer, 'id' | 'name' | 'created_at'>>,
): Map<string, string> {
  // 按码点比较，不受系统语言影响，同一组服务器每次结果相同。
  const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  const ordered = [...servers].sort(
    (a, b) => compare(a.created_at, b.created_at) || compare(a.id, b.id),
  )
  const used = new Set<string>()
  const slugs = new Map<string, string>()
  for (const s of ordered) {
    const base = slugBase(s.name)
    let slug = base
    for (let n = 2; used.has(slug); n++) slug = `${base}_${n}`
    used.add(slug)
    slugs.set(s.id, slug)
  }
  return slugs
}

function stdioTransport(server: MCPServer): McpServerSpec['transport'] | undefined {
  if (!server.command) return undefined
  // 账户引用覆盖同名的字面变量，与旧传输的优先级一致。
  const env: Record<string, string | SecretRef> = { ...server.env }
  for (const [name, keyName] of Object.entries(server.envFromAccount ?? {})) {
    env[name] = { secret: accountSecret(keyName) }
  }
  return {
    kind: 'stdio',
    command: server.command,
    ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  }
}

function httpTransport(server: MCPServer): McpServerSpec['transport'] | undefined {
  if (!server.url) return undefined
  const headers: Record<string, SecretRef> = {}
  const auth = server.auth
  if (auth?.type === 'bearer' && auth.token) {
    const secret = mcpAuthSecret(server.id, 'token')
    headers.Authorization = { secret, template: `Bearer \${${secret}}` }
  }
  if (auth?.type === 'apiKey' && auth.apiKey) {
    headers['X-API-Key'] = { secret: mcpAuthSecret(server.id, 'apiKey') }
  }
  return {
    kind: 'http',
    url: server.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

/** 一行配置 → 引擎规格；stdio 缺 command、http 缺 url 时返回 undefined。 */
export function toMcpSpec(server: MCPServer, slug: string): McpServerSpec | undefined {
  const transport = server.type === 'stdio' ? stdioTransport(server) : httpTransport(server)
  if (!transport) return undefined
  return {
    name: slug,
    transport,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    callTimeoutMs: CALL_TIMEOUT_MS,
  }
}
