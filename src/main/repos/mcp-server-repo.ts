import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index'
import log from 'electron-log'

export type MCPServerType = 'stdio' | 'http'

export interface MCPAuthConfig {
  type: 'none' | 'bearer' | 'apiKey'
  token?: string
  apiKey?: string
}

export interface MCPServerRow {
  id: string
  name: string
  type: MCPServerType
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  auth: string | null
  enabled: number
  created_at: string
  updated_at: string
  env_from_account: string | null
}

export interface MCPServer {
  id: string
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** 凭据引用：子进程环境变量名 → 账户里的 key 名。 */
  envFromAccount?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled: boolean
  created_at: string
  updated_at: string
}

/** 加解密对象，与 AccountStore 用同一个（Electron safeStorage）。 */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(value: string): string
  decrypt(encrypted: string): string
}

let cipher: SecretCipher | undefined

/** 启动时设置；未设置或不可用时凭据明文存储（与 AccountStore 的降级一致）。 */
export function setMcpAuthCipher(next: SecretCipher | undefined): void {
  cipher = next
}

const SECRET_FIELDS = ['token', 'apiKey'] as const

/** auth 列里的形状：密钥字段加密后带 encrypted 标记，只存在于列里。 */
type StoredAuth = MCPAuthConfig & { encrypted?: true }

function hasSecret(auth: MCPAuthConfig): boolean {
  return SECRET_FIELDS.some((f) => !!auth[f])
}

/** 写入 auth 列的值：有密钥且加解密可用时加密，否则明文并告警。 */
function authColumnOf(auth: MCPAuthConfig | undefined, serverName: string): string | null {
  if (!auth) return null
  if (!hasSecret(auth)) return JSON.stringify(auth)
  if (!cipher?.isAvailable()) {
    log.warn(
      '[MCPServerRepo] safeStorage unavailable, storing MCP credential in plaintext:',
      serverName,
    )
    return JSON.stringify(auth)
  }
  const stored: StoredAuth = { ...auth, encrypted: true }
  for (const f of SECRET_FIELDS) {
    if (auth[f]) stored[f] = cipher.encrypt(auth[f])
  }
  return JSON.stringify(stored)
}

/** 读出 auth 列：解密密钥字段；解密失败时去掉该字段并记录，不抛异常。 */
function authOf(column: string, id: string): MCPAuthConfig {
  const { encrypted, ...auth } = JSON.parse(column) as StoredAuth
  if (encrypted !== true) return auth
  for (const f of SECRET_FIELDS) {
    const value = auth[f]
    if (!value) continue
    try {
      if (!cipher?.isAvailable()) throw new Error('safeStorage unavailable')
      auth[f] = cipher.decrypt(value)
    } catch (err) {
      delete auth[f]
      log.error(
        '[MCPServerRepo] Failed to decrypt MCP credential:',
        id,
        f,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
  return auth
}

function rowToMCPServer(row: MCPServerRow): MCPServer {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    command: row.command ?? undefined,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    envFromAccount: row.env_from_account ? JSON.parse(row.env_from_account) : undefined,
    url: row.url ?? undefined,
    auth: row.auth ? authOf(row.auth, row.id) : undefined,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export const mcpServerRepo = {
  list(): MCPServer[] {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC')
      .all() as MCPServerRow[]
    return rows.map(rowToMCPServer)
  },

  create(params: {
    name: string
    type: MCPServerType
    command?: string
    args?: string[]
    env?: Record<string, string>
    envFromAccount?: Record<string, string>
    url?: string
    auth?: MCPAuthConfig
    enabled?: boolean
  }): MCPServer {
    const db = getDb()
    const id = uuidv4()
    const enabled = params.enabled ?? true
    const now = new Date().toISOString()
    db.prepare(
      `
      INSERT INTO mcp_servers (id, name, type, command, args, env, url, auth, enabled, created_at, updated_at, env_from_account)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      params.name,
      params.type,
      params.command ?? null,
      params.args ? JSON.stringify(params.args) : null,
      params.env ? JSON.stringify(params.env) : null,
      params.url ?? null,
      authColumnOf(params.auth, params.name),
      enabled ? 1 : 0,
      now,
      now,
      params.envFromAccount ? JSON.stringify(params.envFromAccount) : null,
    )
    log.info('[MCPServerRepo] Created server:', id, params.name)
    return {
      id,
      name: params.name,
      type: params.type,
      command: params.command,
      args: params.args,
      env: params.env,
      envFromAccount: params.envFromAccount,
      url: params.url,
      auth: params.auth,
      enabled,
      created_at: now,
      updated_at: now,
    }
  },

  getById(id: string): MCPServer | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
      | MCPServerRow
      | undefined
    return row ? rowToMCPServer(row) : null
  },

  getByName(name: string): MCPServer | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as
      | MCPServerRow
      | undefined
    return row ? rowToMCPServer(row) : null
  },

  update(
    id: string,
    params: Partial<{
      name: string
      type: MCPServerType
      command: string
      args: string[]
      env: Record<string, string>
      envFromAccount: Record<string, string>
      url: string
      auth: MCPAuthConfig
      enabled: boolean
    }>,
  ): MCPServer | null {
    const db = getDb()
    const existing = this.getById(id)
    if (!existing) return null

    const now = new Date().toISOString()
    const updates: string[] = []
    const values: unknown[] = []

    if (params.name !== undefined) {
      updates.push('name = ?')
      values.push(params.name)
    }
    if (params.type !== undefined) {
      updates.push('type = ?')
      values.push(params.type)
    }
    if (params.command !== undefined) {
      updates.push('command = ?')
      values.push(params.command)
    }
    if (params.args !== undefined) {
      updates.push('args = ?')
      values.push(JSON.stringify(params.args))
    }
    if (params.env !== undefined) {
      updates.push('env = ?')
      values.push(JSON.stringify(params.env))
    }
    if (params.envFromAccount !== undefined) {
      updates.push('env_from_account = ?')
      values.push(JSON.stringify(params.envFromAccount))
    }
    if (params.url !== undefined) {
      updates.push('url = ?')
      values.push(params.url)
    }
    if (params.auth !== undefined) {
      updates.push('auth = ?')
      values.push(authColumnOf(params.auth, params.name ?? existing.name))
    }
    if (params.enabled !== undefined) {
      updates.push('enabled = ?')
      values.push(params.enabled ? 1 : 0)
    }

    if (updates.length === 0) return existing

    updates.push('updated_at = ?')
    values.push(now)
    values.push(id)

    const sql = `UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`
    db.prepare(sql).run(...values)
    log.info('[MCPServerRepo] Updated server:', id)
    return this.getById(id)
  },

  setEnabled(id: string, enabled: boolean): MCPServer | null {
    const db = getDb()
    const now = new Date().toISOString()
    const info = db
      .prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id)
    if (info.changes === 0) return null
    log.info('[MCPServerRepo] Set enabled:', id, enabled)
    return this.getById(id)
  },

  delete(id: string): void {
    const db = getDb()
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    log.info('[MCPServerRepo] Deleted server:', id)
  },

  /**
   * 启动迁移：把明文存储的 token、apiKey 改为加密（不改 updated_at）。
   * 加解密不可用时不动任何行。返回改写的行数。
   */
  encryptStoredAuth(): number {
    if (!cipher?.isAvailable()) return 0
    const db = getDb()
    const rows = db
      .prepare('SELECT id, name, auth FROM mcp_servers WHERE auth IS NOT NULL')
      .all() as Array<Pick<MCPServerRow, 'id' | 'name'> & { auth: string }>
    const update = db.prepare('UPDATE mcp_servers SET auth = ? WHERE id = ?')
    const count = db.transaction(() => {
      let n = 0
      for (const row of rows) {
        const stored = JSON.parse(row.auth) as StoredAuth
        if (stored.encrypted === true || !hasSecret(stored)) continue
        update.run(authColumnOf(stored, row.name), row.id)
        n++
      }
      return n
    })()
    if (count > 0) log.info('[MCPServerRepo] Encrypted stored credentials:', count)
    return count
  },

  upsertFromConfig(
    name: string,
    config: {
      type: MCPServerType
      command?: string
      args?: string[]
      env?: Record<string, string>
      envFromAccount?: Record<string, string>
      url?: string
      auth?: MCPAuthConfig
    },
  ): MCPServer {
    const existing = this.getByName(name)
    if (existing) {
      return this.update(existing.id, config) ?? existing
    }
    return this.create({ name, ...config })
  },
}
