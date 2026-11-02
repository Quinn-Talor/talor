import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createMcpHost } from 'agent-engine'
import { fakeMcpServer } from 'agent-engine/testing'
import type { MCPServer } from '../repos/mcp-server-repo'
import { mcpSlugs, toMcpSpec } from './mcp-spec'
import { accountSecret, createTalorVault, envSecret, mcpAuthSecret } from './vault'

const AT = '2026-01-01T00:00:00.000Z'

const SERVERS: MCPServer[] = [
  {
    id: 's1',
    name: 'remote',
    type: 'http',
    url: 'https://mcp.example.com',
    auth: { type: 'bearer', token: 't0k' },
    enabled: true,
    created_at: AT,
    updated_at: AT,
  },
  {
    id: 's2',
    name: 'keyed',
    type: 'http',
    url: 'https://k.example.com',
    auth: { type: 'apiKey', apiKey: 'k3y' },
    enabled: true,
    created_at: AT,
    updated_at: AT,
  },
  {
    id: 's3',
    name: 'gh',
    type: 'stdio',
    command: 'npx',
    envFromAccount: { GH_TOKEN: 'github_pat' },
    enabled: true,
    created_at: AT,
    updated_at: AT,
  },
]

const vault = createTalorVault({
  accountValue: (key) => ({ github_pat: 'v1', GITHUB_TOKEN: 'acc' })[key],
  mcpServer: (id) => SERVERS.find((s) => s.id === id) ?? null,
  envValue: (name) => ({ GITHUB_TOKEN: 'proc', ONLY_ENV: 'e' })[name],
})

describe('TalorVault', () => {
  it('AC-012 builds reference names', () => {
    expect(accountSecret('github_pat')).toBe('account:github_pat')
    expect(mcpAuthSecret('s1', 'token')).toBe('mcp:s1:token')
    expect(mcpAuthSecret('s2', 'apiKey')).toBe('mcp:s2:apiKey')
  })

  it('AC-012 resolves account values and MCP credentials', async () => {
    expect(await vault.resolve({ secret: 'account:github_pat' })).toBe('v1')
    expect(await vault.resolve({ secret: 'mcp:s1:token' })).toBe('t0k')
    expect(await vault.resolve({ secret: 'mcp:s2:apiKey' })).toBe('k3y')
  })

  it('AC-012 rejects missing or unknown references without leaking values', async () => {
    for (const secret of [
      'account:missing',
      'mcp:nope:token',
      'mcp:s1:apiKey',
      'mcp:s1:secret',
      'env:HOME',
    ]) {
      const error = await vault.resolve({ secret }).then(
        () => undefined,
        (e: unknown) => e,
      )
      expect(error, secret).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain(secret)
      for (const value of ['v1', 't0k', 'k3y']) expect(message).not.toContain(value)
    }
  })

  it('B1 AC-011 resolves env references from the account first, then the process env', async () => {
    expect(envSecret('X')).toBe('env:X')
    expect(await vault.resolve({ secret: 'env:GITHUB_TOKEN' })).toBe('acc')
    expect(await vault.resolve({ secret: 'env:ONLY_ENV' })).toBe('e')
    for (const secret of ['env:MISSING', 'env:1BAD']) {
      const error = await vault.resolve({ secret }).then(
        () => undefined,
        (e: unknown) => e as Error,
      )
      expect(error?.message, secret).toContain(secret)
      for (const value of ['acc', 'proc']) expect(error!.message).not.toContain(value)
    }
  })

  it('AC-013 gives the engine MCP host the real credentials when it connects', async () => {
    const fake = fakeMcpServer({ tools: [{ name: 'ping' }] })
    const host = createMcpHost({ connect: fake.connect })
    const slugs = mcpSlugs(SERVERS)
    const signal = new AbortController().signal
    for (const s of [SERVERS[0]!, SERVERS[2]!]) {
      const lease = await host.acquire(toMcpSpec(s, slugs.get(s.id)!)!, { vault, signal })
      lease.release()
    }

    expect(fake.connects.map((c) => c.transport)).toEqual([
      {
        kind: 'http',
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer t0k' },
      },
      { kind: 'stdio', command: 'npx', env: { GH_TOKEN: 'v1' } },
    ])
    await host.shutdown?.()
  })
})
