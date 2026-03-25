import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockServers: Array<{
  id: string
  name: string
  type: string
  command: string | null
  args: string | null
  env: string | null
  url: string | null
  auth: string | null
  enabled: number
  created_at: string
  updated_at: string
}> = []

vi.mock('../db/index', () => {
  return {
    getDb: () => ({
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO mcp_servers')) {
            const server = {
              id: args[0] as string,
              name: args[1] as string,
              type: args[2] as string,
              command: args[3] as string | null,
              args: args[4] as string | null,
              env: args[5] as string | null,
              url: args[6] as string | null,
              auth: args[7] as string | null,
              enabled: args[8] as number,
              created_at: args[9] as string,
              updated_at: args[10] as string,
            }
            mockServers.push(server)
            return { changes: 1 }
          }
          if (sql.includes('UPDATE mcp_servers SET enabled')) {
            const [enabled, updatedAt, id] = args as [number, string, string]
            const s = mockServers.find(s => s.id === id)
            if (s) { s.enabled = enabled; s.updated_at = updatedAt; return { changes: 1 } }
            return { changes: 0 }
          }
          if (sql.includes('UPDATE mcp_servers SET') && sql.includes('name = ?')) {
            // Handle general UPDATE with multiple fields
            const updateStr = sql.split('SET')[1].split('WHERE')[0]
            const [updatedAt, id] = [args[args.length - 2] as string, args[args.length - 1] as string]
            const s = mockServers.find(s => s.id === id)
            if (s) {
              // Parse which fields are being updated based on position
              const setParts = updateStr.split(',').map((p: string) => p.trim())
              let argIdx = 0
              for (const part of setParts) {
                if (part.startsWith('name')) s.name = args[argIdx] as string
                if (part.startsWith('type')) s.type = args[argIdx] as string
                if (part.startsWith('url')) s.url = args[argIdx] as string
                if (part.startsWith('command')) s.command = args[argIdx] as string | null
                if (part.startsWith('args')) s.args = args[argIdx] as string | null
                if (part.startsWith('env')) s.env = args[argIdx] as string | null
                if (part.startsWith('auth')) s.auth = args[argIdx] as string | null
                if (!part.startsWith('updated_at')) argIdx++
              }
              s.updated_at = updatedAt
              return { changes: 1 }
            }
            return { changes: 0 }
          }
          if (sql.includes('DELETE FROM mcp_servers')) {
            const id = args[0] as string
            const idx = mockServers.findIndex(s => s.id === id)
            if (idx >= 0) { mockServers.splice(idx, 1); return { changes: 1 } }
            return { changes: 0 }
          }
          return { changes: 1 }
        },
        get: (idOrName: string) => {
          if (sql.includes('WHERE id = ?')) {
            return mockServers.find(s => s.id === idOrName)
          }
          if (sql.includes('WHERE name = ?')) {
            return mockServers.find(s => s.name === idOrName)
          }
          return undefined
        },
        all: () => mockServers,
      }),
    }),
  }
})

import { mcpServerRepo, MCPServerType } from './mcp-server-repo'

describe('mcpServerRepo', () => {
  beforeEach(() => {
    mockServers.length = 0
  })

  describe('AC-001-01: Create STDIO MCP Server', () => {
    it('creates a STDIO server with all fields', () => {
      const result = mcpServerRepo.create({
        name: '文件系统',
        type: 'stdio' as MCPServerType,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/qunn/Desktop'],
        env: { HOME: '/Users/qunn' },
      })

      expect(result.name).toBe('文件系统')
      expect(result.type).toBe('stdio')
      expect(result.command).toBe('npx')
      expect(result.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/Users/qunn/Desktop'])
      expect(result.enabled).toBe(true)
      expect(result.id).toBeDefined()
    })

    it('saves STDIO server to list', () => {
      mcpServerRepo.create({
        name: 'filesystem',
        type: 'stdio',
        command: 'npx',
      })
      const list = mcpServerRepo.list()
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('filesystem')
    })
  })

  describe('AC-001-02: Create HTTP MCP Server', () => {
    it('creates an HTTP server with url and auth', () => {
      const result = mcpServerRepo.create({
        name: 'GitHub API',
        type: 'http' as MCPServerType,
        url: 'https://mcp.example.com/github',
        auth: { type: 'bearer', token: 'test-token' },
      })

      expect(result.name).toBe('GitHub API')
      expect(result.type).toBe('http')
      expect(result.url).toBe('https://mcp.example.com/github')
      expect(result.auth?.type).toBe('bearer')
      expect(result.auth?.token).toBe('test-token')
    })

    it('saves HTTP server to list', () => {
      mcpServerRepo.create({
        name: 'github',
        type: 'http',
        url: 'https://api.example.com',
      })
      const list = mcpServerRepo.list()
      expect(list).toHaveLength(1)
      expect(list[0].type).toBe('http')
    })
  })

  describe('AC-001-03: Update MCP Server', () => {
    it('updates server name', () => {
      const created = mcpServerRepo.create({
        name: '测试 Server',
        type: 'stdio',
        command: 'npx',
      })

      const updated = mcpServerRepo.update(created.id, { name: '正式 Server' })
      expect(updated?.name).toBe('正式 Server')
    })

    it('returns null for non-existent server', () => {
      const result = mcpServerRepo.update('non-existent-id', { name: 'test' })
      expect(result).toBeNull()
    })
  })

  describe('AC-003-01: Disable MCP Server', () => {
    it('sets enabled to false', () => {
      const created = mcpServerRepo.create({
        name: 'test',
        type: 'stdio',
        command: 'npx',
      })

      const result = mcpServerRepo.setEnabled(created.id, false)
      expect(result?.enabled).toBe(false)
    })
  })

  describe('AC-003-02: Enable MCP Server', () => {
    it('sets enabled to true', () => {
      const created = mcpServerRepo.create({
        name: 'test',
        type: 'stdio',
        command: 'npx',
      })
      mcpServerRepo.setEnabled(created.id, false)

      const result = mcpServerRepo.setEnabled(created.id, true)
      expect(result?.enabled).toBe(true)
    })
  })

  describe('AC-004-01: Delete MCP Server', () => {
    it('removes server from list', () => {
      const created = mcpServerRepo.create({
        name: 'test',
        type: 'stdio',
        command: 'npx',
      })

      mcpServerRepo.delete(created.id)
      const list = mcpServerRepo.list()
      expect(list).toHaveLength(0)
    })
  })

  describe('getByName', () => {
    it('finds server by name', () => {
      mcpServerRepo.create({ name: 'unique-name', type: 'stdio', command: 'npx' })
      const result = mcpServerRepo.getByName('unique-name')
      expect(result?.name).toBe('unique-name')
    })

    it('returns null for non-existent name', () => {
      const result = mcpServerRepo.getByName('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('upsertFromConfig', () => {
    it('creates new server if name does not exist', () => {
      const result = mcpServerRepo.upsertFromConfig('new-server', {
        type: 'stdio',
        command: 'npx',
      })
      expect(result.name).toBe('new-server')
    })

    it('finds existing server by name', () => {
      mcpServerRepo.create({ name: 'existing', type: 'stdio', command: 'npx' })
      const result = mcpServerRepo.upsertFromConfig('existing', {
        type: 'http',
        url: 'https://new.url',
      })
      expect(result).not.toBeNull()
    })
  })
})
