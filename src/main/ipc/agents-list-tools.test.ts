// agents:list-tools：返回引擎按能力目录为 agent 选出的工具（修 T7）。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, status, repo } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  status: {
    // 引擎连接池里各服务器的工具；notion 不在 biz 的 mcpServers 里，按服务器名过滤掉
    mcpServerTools: vi.fn(async () => [
      {
        serverId: 'm1',
        name: 'github',
        connected: true,
        tools: [{ name: 'create_issue', description: 'gh', inputSchema: { type: 'object' } }],
      },
      {
        serverId: 'm2',
        name: 'notion',
        connected: true,
        tools: [{ name: 'search', inputSchema: { type: 'object' } }],
      },
    ]),
  },
  repo: {
    list: vi.fn(() => [
      {
        id: 'm1',
        name: 'github',
        type: 'stdio',
        command: 'npx',
        enabled: true,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      {
        id: 'm2',
        name: 'notion',
        type: 'stdio',
        command: 'npx',
        enabled: true,
        created_at: '2026-01-02',
        updated_at: '2026-01-02',
      },
    ]),
  },
}))

vi.mock('electron', () => ({ ipcMain: { handle: (...a: unknown[]) => mockHandle(...a) } }))
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../runtime/mcp-status', () => status)
vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: repo }))

import type { AgentProfile } from '@shared/types/agent'
import type { AgentManager } from '../agent/agent-manager'
import '../tools/builtin'
import { catalogRegistry, talorCatalogSources } from '../runtime/catalog'
import { registerAgentHandlers } from './agents'

const BIZ: AgentProfile = {
  id: 'biz',
  name: 'Biz',
  description: 'biz',
  agentPrompt: 'x',
  tools: ['bash'],
  mcpServers: ['github'],
}
const INV: AgentProfile = { id: 'inv', name: 'Inv', description: 'inv', agentPrompt: 'x' }

const manager = {
  getAgent: (id: string) =>
    id === 'biz'
      ? { profile: BIZ, source: null }
      : id === 'inv'
        ? { profile: INV, source: null }
        : null,
  listBusinessAgentIds: () => ['biz', 'inv'],
  featureAgentIds: () => new Set(['inv']),
  getPlatformSkillRegistry: () => null,
  getLoader: () => null,
  getFeatureAgentProfiles: () => [],
} as unknown as AgentManager

function handler() {
  return mockHandle.mock.calls.find((c) => c[0] === 'agents:list-tools')![1] as (
    e: unknown,
    id: string,
  ) => Promise<unknown>
}

describe('agents:list-tools', () => {
  const unregister: Array<() => void> = []
  beforeEach(() => {
    mockHandle.mockClear()
    registerAgentHandlers(manager)
    while (unregister.length > 0) unregister.pop()!()
    unregister.push(catalogRegistry.register('talor', talorCatalogSources(manager)))
  })

  it('AC-008 lists the catalog tools, MCP tools from the engine pool', async () => {
    const tools = (await handler()(null, 'biz')) as Array<{
      name: string
      provider?: string
      description: string
      parameters: unknown
    }>
    expect(tools.map((t) => t.name)).toEqual([
      'read',
      'glob',
      'ls',
      'grep',
      'bash',
      'search_tool',
      'create_issue',
    ])
    expect(tools.find((t) => t.name === 'create_issue')).toEqual({
      name: 'create_issue',
      description: 'gh',
      parameters: { type: 'object' },
      provider: 'github',
    })
    expect(status.mcpServerTools).toHaveBeenCalled()
    expect(tools.map((t) => t.name)).not.toContain('search')
  })

  it('AC-008 still rejects an unknown agent', async () => {
    await expect(handler()(null, 'nope')).rejects.toThrow('Agent not found: nope')
  })

  it('B1 AC-020 lists feature and plugin capabilities from the global registry', async () => {
    unregister.push(
      catalogRegistry.register('feature:f1', {
        agents: () => [
          {
            profile: INV,
            featureTools: [
              {
                name: 'quote',
                description: 'q',
                parameters: { type: 'object' },
                execute: async () => ({ output: 'q' }),
              },
            ],
          },
        ],
      }),
      catalogRegistry.register('plugins', {
        mcpEntries: () => [
          {
            id: 'plugin:alpha:gh',
            name: 'alpha:gh',
            slug: 'plugin_alpha_gh',
            spec: { name: 'plugin_alpha_gh', transport: { kind: 'stdio', command: 'gh' } },
          },
        ],
      }),
    )
    const names = ((await handler()(null, 'inv')) as Array<{ name: string }>).map((t) => t.name)
    expect(names).toContain('quote')
    expect(names).toContain('search_tool')
  })
})
