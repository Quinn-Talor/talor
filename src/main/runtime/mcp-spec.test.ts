import { describe, it, expect } from 'vitest'
import type { MCPServer } from '../repos/mcp-server-repo'
import { mcpSlugs, toMcpSpec } from './mcp-spec'

function server(overrides: Partial<MCPServer>): MCPServer {
  return {
    id: 's1',
    name: 'srv',
    type: 'stdio',
    enabled: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mcpSlugs', () => {
  it('AC-009 normalises names and keeps them unique in creation order', () => {
    const names = ['GitHub MCP', 'github-mcp', '飞书', 'a/b//c', 'GitHub MCP', 'x'.repeat(40)]
    const servers = names.map((name, i) => ({
      id: `id${i}`,
      name,
      created_at: `2026-01-0${i + 1}T00:00:00.000Z`,
    }))
    // 输入顺序与创建时间无关
    const slugs = mcpSlugs([...servers].reverse())
    expect(servers.map((s) => slugs.get(s.id))).toEqual([
      'GitHub_MCP',
      'github-mcp',
      'mcp',
      'a_b_c',
      'GitHub_MCP_2',
      'x'.repeat(32),
    ])
  })

  it('AC-009 orders servers created at the same time by id', () => {
    const at = '2026-01-01T00:00:00.000Z'
    const slugs = mcpSlugs([
      { id: 'b', name: 'fs', created_at: at },
      { id: 'a', name: 'fs', created_at: at },
    ])
    expect([slugs.get('a'), slugs.get('b')]).toEqual(['fs', 'fs_2'])
  })

  it('AC-009 skips a numbered slug that is already taken and trims after cutting', () => {
    const slugs = mcpSlugs([
      { id: '1', name: 'fs', created_at: '2026-01-01' },
      { id: '2', name: 'fs_2', created_at: '2026-01-02' },
      { id: '3', name: 'fs', created_at: '2026-01-03' },
      { id: '4', name: `${'y'.repeat(31)} z`, created_at: '2026-01-04' },
      { id: '5', name: '__weird--', created_at: '2026-01-05' },
    ])
    expect([...slugs.values()]).toEqual(['fs', 'fs_2', 'fs_3', 'y'.repeat(31), 'weird'])
  })
})

describe('toMcpSpec', () => {
  it('AC-010 maps a stdio server with literal and account variables', () => {
    const spec = toMcpSpec(
      server({
        command: 'npx',
        args: ['-y', 'gh-mcp'],
        env: { LOG: 'debug', GH_TOKEN: 'literal' },
        envFromAccount: { GH_TOKEN: 'github_pat' },
      }),
      'gh',
    )
    expect(spec).toEqual({
      name: 'gh',
      transport: {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', 'gh-mcp'],
        env: { LOG: 'debug', GH_TOKEN: { secret: 'account:github_pat' } },
      },
      connectTimeoutMs: 60000,
      callTimeoutMs: 300000,
    })
  })

  it('AC-010 leaves out empty args and env', () => {
    for (const extra of [{}, { args: [], env: {}, envFromAccount: {} }]) {
      expect(toMcpSpec(server({ command: 'node', ...extra }), 'n')?.transport).toEqual({
        kind: 'stdio',
        command: 'node',
      })
    }
  })

  it('AC-011 maps http credentials to references', () => {
    const http = (auth: MCPServer['auth']) =>
      toMcpSpec(server({ type: 'http', url: 'https://mcp.example.com', auth }), 'x')
    expect(http({ type: 'bearer', token: 't0k' })?.transport).toEqual({
      kind: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: { secret: 'mcp:s1:token', template: 'Bearer ${mcp:s1:token}' } },
    })
    expect(http({ type: 'apiKey', apiKey: 'k3y' })?.transport).toEqual({
      kind: 'http',
      url: 'https://mcp.example.com',
      headers: { 'X-API-Key': { secret: 'mcp:s1:apiKey' } },
    })
    for (const auth of [
      { type: 'bearer' as const, token: '' },
      { type: 'none' as const },
      undefined,
    ]) {
      expect(http(auth)?.transport).toEqual({ kind: 'http', url: 'https://mcp.example.com' })
    }
    const all = JSON.stringify([
      http({ type: 'bearer', token: 't0k' }),
      http({ type: 'apiKey', apiKey: 'k3y' }),
    ])
    expect(all).not.toContain('t0k')
    expect(all).not.toContain('k3y')
  })

  it('AC-011 returns undefined for a server without command or url', () => {
    expect(toMcpSpec(server({ type: 'http' }), 'x')).toBeUndefined()
    expect(toMcpSpec(server({ type: 'stdio' }), 'x')).toBeUndefined()
  })
})
