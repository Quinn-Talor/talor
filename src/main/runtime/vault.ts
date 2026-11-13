// src/main/runtime/vault.ts — 业务层：Talor 凭据库（agent-engine 的 Vault）
//
// 引擎规格里只放凭据引用，建连时由凭据库按引用名取值（能力架构方案 §3.7）：
//   account:<keyName>             账户凭据（AccountStore.getValue）
//   mcp:<serverId>:token|apiKey   MCP 服务器的凭据（仓库读出时已解密）
//   env:<VAR>                     插件 .mcp.json 的 ${VAR}：先查同名账户 key，再读主进程环境变量
// 取不到值或引用名不认识时拒绝；错误消息只含引用名，不含任何凭据值。
//
// 允许依赖: agent-engine（类型）、accounts/account-store、repos/mcp-server-repo
// 禁止依赖: ipc/*、db/*

import type { Vault } from '@talor/agent-engine'
import { AccountStore } from '../accounts/account-store'
import { mcpServerRepo, type MCPServer } from '../repos/mcp-server-repo'

export type McpAuthField = 'token' | 'apiKey'

const MCP_AUTH = /^mcp:([^:]+):(token|apiKey)$/
const ENV = /^env:([A-Za-z_][A-Za-z0-9_]*)$/

export function accountSecret(keyName: string): string {
  return `account:${keyName}`
}

export function mcpAuthSecret(serverId: string, field: McpAuthField): string {
  return `mcp:${serverId}:${field}`
}

export function envSecret(name: string): string {
  return `env:${name}`
}

export function createTalorVault(deps: {
  accountValue(keyName: string): string | undefined
  mcpServer(id: string): MCPServer | null
  envValue(name: string): string | undefined
}): Vault {
  function lookup(name: string): string | undefined {
    if (name.startsWith('account:')) return deps.accountValue(name.slice('account:'.length))
    const mcp = MCP_AUTH.exec(name)
    if (mcp) return deps.mcpServer(mcp[1]!)?.auth?.[mcp[2] as McpAuthField]
    const env = ENV.exec(name)
    if (env) return deps.accountValue(env[1]!) ?? deps.envValue(env[1]!)
    throw new Error(`未知的凭据引用：${name}`)
  }
  return {
    async resolve(ref) {
      const value = lookup(ref.secret)
      if (!value) throw new Error(`凭据不存在：${ref.secret}`)
      return value
    },
  }
}

export function talorVault(): Vault {
  return createTalorVault({
    accountValue: (keyName) => AccountStore.getInstance()?.getValue(keyName),
    mcpServer: (id) => mcpServerRepo.getById(id),
    envValue: (name) => process.env[name],
  })
}
