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
}

export interface MCPServer {
  id: string
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled: boolean
  created_at: string
  updated_at: string
}

function rowToMCPServer(row: MCPServerRow): MCPServer {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    command: row.command ?? undefined,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    url: row.url ?? undefined,
    auth: row.auth ? JSON.parse(row.auth) : undefined,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export const mcpServerRepo = {
  list(): MCPServer[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all() as MCPServerRow[]
    return rows.map(rowToMCPServer)
  },

  create(params: {
    name: string
    type: MCPServerType
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    auth?: MCPAuthConfig
  }): MCPServer {
    const db = getDb()
    const id = uuidv4()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO mcp_servers (id, name, type, command, args, env, url, auth, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.name,
      params.type,
      params.command ?? null,
      params.args ? JSON.stringify(params.args) : null,
      params.env ? JSON.stringify(params.env) : null,
      params.url ?? null,
      params.auth ? JSON.stringify(params.auth) : null,
      1,
      now,
      now
    )
    log.info('[MCPServerRepo] Created server:', id, params.name)
    return {
      id,
      name: params.name,
      type: params.type,
      command: params.command,
      args: params.args,
      env: params.env,
      url: params.url,
      auth: params.auth,
      enabled: true,
      created_at: now,
      updated_at: now,
    }
  },

  getById(id: string): MCPServer | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as MCPServerRow | undefined
    return row ? rowToMCPServer(row) : null
  },

  getByName(name: string): MCPServer | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as MCPServerRow | undefined
    return row ? rowToMCPServer(row) : null
  },

  update(id: string, params: Partial<{
    name: string
    type: MCPServerType
    command: string
    args: string[]
    env: Record<string, string>
    url: string
    auth: MCPAuthConfig
  }>): MCPServer | null {
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
    if (params.url !== undefined) {
      updates.push('url = ?')
      values.push(params.url)
    }
    if (params.auth !== undefined) {
      updates.push('auth = ?')
      values.push(JSON.stringify(params.auth))
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
    const info = db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id)
    if (info.changes === 0) return null
    log.info('[MCPServerRepo] Set enabled:', id, enabled)
    return this.getById(id)
  },

  delete(id: string): void {
    const db = getDb()
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    log.info('[MCPServerRepo] Deleted server:', id)
  },

  upsertFromConfig(name: string, config: {
    type: MCPServerType
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    auth?: MCPAuthConfig
  }): MCPServer {
    const existing = this.getByName(name)
    if (existing) {
      return this.update(existing.id, config) ?? existing
    }
    return this.create({ name, ...config })
  },
}
