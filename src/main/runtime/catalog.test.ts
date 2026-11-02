import { describe, it, expect, vi } from 'vitest'

const { repo, registry } = vi.hoisted(() => ({
  repo: { list: vi.fn(() => [] as unknown[]) },
  registry: { listAll: vi.fn(() => [] as unknown[]) },
}))

vi.mock('../repos/mcp-server-repo', () => ({ mcpServerRepo: repo }))
vi.mock('../tools/registry', () => ({ toolRegistry: registry }))
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import log from 'electron-log'

import type { AgentProfile } from '@shared/types/agent'
import type { AgentManager } from '../agent/agent-manager'
import type { MCPServer } from '../repos/mcp-server-repo'
import type { ParsedSkill } from '../skills/types'
import type { ToolDefinition } from '../tools/types'
import {
  catalogRegistry,
  catalogSnapshot,
  createCatalogRegistry,
  currentCatalog,
  engineToolsView,
  expandCommand,
  isPlatformAgent,
  talorCatalogSources,
  type CatalogCommand,
  type CatalogSources,
  type McpCatalogEntry,
} from './catalog'

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object' },
    execute: async () => ({ output: name }),
  }
}

const BUILTINS = [
  'read',
  'glob',
  'write',
  'ls',
  'grep',
  'edit',
  'bash',
  'request_continuation',
].map(tool)

function server(id: string, name: string, day: number, extra: Partial<MCPServer> = {}): MCPServer {
  const at = `2026-01-0${day}T00:00:00.000Z`
  return {
    id,
    name,
    type: 'stdio',
    command: 'npx',
    enabled: true,
    created_at: at,
    updated_at: at,
    ...extra,
  }
}

const SERVERS: MCPServer[] = [
  server('m2', 'notion', 2),
  server('m1', 'github', 1),
  server('m3', 'legacy', 3, { enabled: false }),
  server('m4', 'broken', 4, { command: undefined }),
]

function skill(name: string, description = `${name} skill`): ParsedSkill {
  return {
    metadata: { name, description },
    content: `# ${name}`,
    filePath: `/skills/${name}/SKILL.md`,
  }
}

const SKILLS = [skill('lark-doc'), skill('pdf')]

function profile(id: string, extra: Partial<AgentProfile> = {}): AgentProfile {
  return { id, name: id, description: '', agentPrompt: `${id} prompt`, ...extra }
}

const AGENTS = [
  { profile: profile('a'), featureTools: [] },
  {
    profile: profile('b', { subagents: { allowAny: true, ids: [{ id: 'a', required: false }] } }),
    featureTools: [],
  },
  {
    profile: profile('c', {
      subagents: {
        ids: ['a', 'ghost', '__chat__', 'c'].map((id) => ({ id, required: false })),
      },
    }),
    featureTools: [],
  },
  { profile: profile('feat', { tools: ['read'] }), featureTools: [tool('invest_quote')] },
]

function sources(overrides: Partial<CatalogSources> = {}): CatalogSources {
  return {
    builtins: () => BUILTINS,
    mcpServers: () => SERVERS,
    skills: () => SKILLS,
    agents: () => AGENTS,
    ...overrides,
  }
}

const names = (items: Array<{ name: string }>) => items.map((t) => t.name)

describe('catalogSnapshot', () => {
  const snapshot = catalogSnapshot(sources())

  it('AC-001 selects builtin tools by the profile tool list', () => {
    const all = ['read', 'glob', 'write', 'ls', 'grep', 'edit', 'bash']
    expect(names(snapshot.builtins)).toEqual(all)
    expect(names(snapshot.select(profile('x')).builtins)).toEqual(all)
    expect(names(snapshot.select(profile('x', { tools: [] })).builtins)).toEqual(all)
    expect(names(snapshot.select(profile('x', { tools: ['bash'] })).builtins)).toEqual([
      'read',
      'glob',
      'ls',
      'grep',
      'bash',
    ])
  })

  it('AC-002 lists enabled servers with a slug computed over all servers', () => {
    const slugCollision = catalogSnapshot(
      sources({
        mcpServers: () => [server('m1', 'gh', 1, { enabled: false }), server('m2', 'gh', 2)],
      }),
    )
    expect(slugCollision.mcpServers.map((e) => e.slug)).toEqual(['gh_2'])

    expect(snapshot.mcpServers.map((e) => [e.id, e.name, e.slug])).toEqual([
      ['m1', 'github', 'github'],
      ['m2', 'notion', 'notion'],
    ])
    expect(snapshot.mcpServers[0]!.spec).toMatchObject({
      name: 'github',
      transport: { kind: 'stdio', command: 'npx' },
    })
  })

  it('AC-003 selects MCP servers by name, and platform agents get all of them', () => {
    const all = ['github', 'notion']
    expect(names(snapshot.select(profile('x')).mcpServers)).toEqual(all)
    expect(names(snapshot.select(profile('x', { mcpServers: [] })).mcpServers)).toEqual(all)
    const scoped = snapshot.select(profile('x', { mcpServers: ['notion', 'legacy', 'nope'] }))
    expect(names(scoped.mcpServers)).toEqual(['notion'])
    expect(scoped.missing.mcpServers).toEqual(['legacy', 'nope'])
    expect(
      names(snapshot.select(profile('__chat__', { mcpServers: ['notion'] })).mcpServers),
    ).toEqual(all)
  })

  it('AC-004 selects skills by name, and platform agents get all of them', () => {
    const skillNames = (p: AgentProfile) => snapshot.select(p).skills.map((s) => s.metadata.name)
    expect(skillNames(profile('x'))).toEqual([])
    const scoped = snapshot.select(profile('x', { skills: ['pdf', 'missing', 'lark-doc'] }))
    expect(scoped.skills.map((s) => s.metadata.name)).toEqual(['pdf', 'lark-doc'])
    expect(scoped.missing.skills).toEqual(['missing'])
    expect(skillNames(profile('__crystallizer__', { skills: ['pdf'] }))).toEqual([
      'lark-doc',
      'pdf',
    ])
  })

  it('AC-005 selects delegates, letting allowAny win and leaving out the agent itself', () => {
    const delegates = (id: string) => {
      const caps = snapshot.select(AGENTS.find((a) => a.profile.id === id)!.profile)
      return { ids: caps.delegates.map((p) => p.id), missing: caps.missing.subagents }
    }
    expect(delegates('b')).toEqual({ ids: ['a', 'c', 'feat'], missing: [] })
    expect(delegates('c')).toEqual({ ids: ['a'], missing: ['ghost', '__chat__', 'c'] })
    expect(delegates('a')).toEqual({ ids: [], missing: [] })
    expect(
      snapshot
        .select(profile('__chat__', { subagents: { allowAny: true } }))
        .delegates.map((p) => p.id),
    ).toEqual(['a', 'b', 'c', 'feat'])
  })

  it('AC-006 gives an agent its own feature tools regardless of its tool list', () => {
    expect(names(snapshot.select(AGENTS[3]!.profile).featureTools)).toEqual(['invest_quote'])
    expect(snapshot.select(AGENTS[0]!.profile).featureTools).toEqual([])
    expect(snapshot.select(profile('x')).missing).toEqual({
      mcpServers: [],
      skills: [],
      subagents: [],
    })
  })

  it('AC-007 keeps the version for the same sources and changes it with any source', () => {
    expect(catalogSnapshot(sources()).version).toBe(snapshot.version)
    const changed: Array<Partial<CatalogSources>> = [
      { builtins: () => BUILTINS.slice(1) },
      { mcpServers: () => SERVERS.map((s) => (s.id === 'm2' ? { ...s, enabled: false } : s)) },
      {
        mcpServers: () =>
          SERVERS.map((s) =>
            s.id === 'm1' ? { ...s, type: 'http' as const, url: 'https://x' } : s,
          ),
      },
      { skills: () => [skill('lark-doc', 'changed'), skill('pdf')] },
      {
        agents: () =>
          AGENTS.map((a) =>
            a.profile.id === 'a' ? { ...a, profile: { ...a.profile, agentPrompt: 'new' } } : a,
          ),
      },
      {
        agents: () =>
          AGENTS.map((a) =>
            a.profile.id === 'feat' ? { ...a, featureTools: [tool('other')] } : a,
          ),
      },
    ]
    const versions = changed.map((o) => catalogSnapshot(sources(o)).version)
    for (const v of versions) expect(v).not.toBe(snapshot.version)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('treats ids starting with two underscores as platform agents', () => {
    expect(isPlatformAgent('__chat__')).toBe(true)
    expect(isPlatformAgent('chat')).toBe(false)
  })
})

describe('talorCatalogSources', () => {
  function manager(skills: ParsedSkill[] | null): AgentManager {
    const profiles = new Map([
      ['a', profile('a')],
      ['gone', profile('gone')],
    ])
    return {
      listBusinessAgentIds: () => ['a', 'f', 'gone'],
      getAgent: (id: string) =>
        id === 'a' || id === 'f' ? { profile: profiles.get('a') ?? profile(id) } : null,
      featureAgentIds: () => new Set(['f']),
      getPlatformSkillRegistry: () => (skills ? { listAll: () => skills } : null),
    } as unknown as AgentManager
  }

  it('AC-009 reads the tool registry, the MCP table, the platform skills and the business agents', () => {
    registry.listAll.mockReturnValue(BUILTINS)
    repo.list.mockReturnValue([SERVERS[1]])
    const snapshot = catalogSnapshot(talorCatalogSources(manager(SKILLS)))

    expect(names(snapshot.builtins)).toHaveLength(7)
    expect(snapshot.mcpServers.map((e) => e.name)).toEqual(['github'])
    expect(snapshot.skills).toEqual(SKILLS)
    // Feature 承载的 agent 由 Feature 自己登记，核心来源不再给出；核心来源也不带 Feature 工具
    expect(snapshot.agents.map((a) => [a.profile.id, names(a.featureTools)])).toEqual([['a', []]])
  })

  it('AC-009 has no skills when the platform skill registry is missing', () => {
    expect(catalogSnapshot(talorCatalogSources(manager(null))).skills).toEqual([])
  })
})

describe('engineToolsView (A5b)', () => {
  const mcpTools = [
    { name: 'create_issue', description: 'gh', parameters: {}, provider: 'github' },
    { name: 'search', description: 'notion', parameters: {}, provider: 'notion' },
  ]

  it('AC-007 lists the tools the catalog selected for the agent', () => {
    const snapshot = catalogSnapshot(
      sources({
        builtins: () => [tool('read'), tool('bash')],
        mcpServers: () => [server('m1', 'github', 1)],
        skills: () => [skill('pdf')],
        agents: () => [
          { profile: profile('a'), featureTools: [] },
          { profile: profile('feat'), featureTools: [tool('invest_quote')] },
        ],
      }),
    )
    const caps = snapshot.select(
      profile('feat', { skills: ['pdf'], subagents: { ids: [{ id: 'a', required: false }] } }),
    )
    const view = engineToolsView(caps, mcpTools)
    expect(view.map((t) => [t.name, t.provider])).toEqual([
      ['read', undefined],
      ['bash', undefined],
      ['invest_quote', undefined],
      ['search_tool', undefined],
      ['activate_skill', undefined],
      ['delegate', undefined],
      ['create_issue', 'github'],
    ])
    expect(view[0]).toMatchObject({ description: 'read tool', parameters: { type: 'object' } })
  })

  it('AC-007 leaves out the engine tools whose group is empty', () => {
    const snapshot = catalogSnapshot(
      sources({
        builtins: () => [tool('read')],
        mcpServers: () => [],
        skills: () => [],
        agents: () => [],
      }),
    )
    const view = engineToolsView(snapshot.select(profile('x')), mcpTools)
    expect(view.map((t) => t.name)).toEqual(['read'])
  })
})

describe('catalog registry (B1)', () => {
  const entry = (name: string, slug: string): McpCatalogEntry => ({
    id: `plugin:${name}`,
    name,
    slug,
    spec: { name: slug, transport: { kind: 'stdio', command: 'x' } },
  })
  const cmd = (name: string, content = name): CatalogCommand => ({
    name,
    content,
    source: 'test',
  })

  it('B1 AC-001 concatenates sources in registration order, replaces by id and unregisters', () => {
    const registry = createCatalogRegistry()
    registry.register('talor', { builtins: () => [tool('read')], mcpServers: () => [SERVERS[1]!] })
    const unregisterExt = registry.register('ext', {
      mcpEntries: () => [entry('alpha:gh', 'plugin_alpha_gh')],
      skills: () => [skill('pdf')],
      agents: () => [{ profile: profile('a'), featureTools: [] }],
      commands: () => [cmd('ext:c')],
    })
    const src = registry.sources()
    expect(names(src.builtins())).toEqual(['read'])
    expect(src.mcpServers().map((s) => s.name)).toEqual(['github'])
    expect(src.mcpEntries!().map((e) => e.name)).toEqual(['alpha:gh'])
    expect(src.skills().map((s) => s.metadata.name)).toEqual(['pdf'])
    expect(src.agents().map((a) => a.profile.id)).toEqual(['a'])
    expect(src.commands!().map((c) => c.name)).toEqual(['ext:c'])

    registry.register('ext', { skills: () => [skill('lark-doc')] })
    expect(
      registry
        .sources()
        .skills()
        .map((s) => s.metadata.name),
    ).toEqual(['lark-doc'])
    expect(registry.sources().mcpEntries!()).toEqual([])

    unregisterExt()
    expect(registry.sources().skills()).toEqual([])
    expect(names(registry.sources().builtins())).toEqual(['read'])
  })

  it('B1 AC-002 keeps the first entry of each kind and warns about MCP prefix clashes', () => {
    vi.mocked(log.warn).mockClear()
    const snapshot = catalogSnapshot({
      builtins: () => [],
      mcpServers: () => [server('m1', 'gh', 1)],
      mcpEntries: () => [entry('alpha:gh', 'gh')],
      skills: () => [skill('pdf', 'first'), skill('pdf', 'second')],
      agents: () => [
        { profile: profile('a', { name: 'first' }), featureTools: [] },
        { profile: profile('a', { name: 'second' }), featureTools: [] },
      ],
      commands: () => [cmd('x:y', 'first'), cmd('x:y', 'second')],
    })
    expect(snapshot.agents.map((a) => a.profile.name)).toEqual(['first'])
    expect(snapshot.skills.map((s) => s.metadata.description)).toEqual(['first'])
    expect(snapshot.mcpServers.map((e) => [e.name, e.slug])).toEqual([['gh', 'gh']])
    expect(snapshot.commands.map((c) => c.content)).toEqual(['first'])
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).toContain('alpha:gh')
  })

  it('B1 AC-005 snapshots the global registry', () => {
    const empty = currentCatalog()
    expect(empty.builtins).toEqual([])
    expect(empty.agents).toEqual([])
    const unregister = catalogRegistry.register('test-core', { builtins: () => BUILTINS })
    expect(names(currentCatalog().builtins)).toHaveLength(7)
    unregister()
    expect(currentCatalog().builtins).toEqual([])
  })
})

describe('expandCommand (B1)', () => {
  const commands = [
    { name: 'alpha:review', content: 'Review: $ARGUMENTS', source: 'plugin:alpha' },
    { name: 'alpha:plain', content: 'Check the build', source: 'plugin:alpha' },
  ]

  it('B1 AC-015 expands known plugin commands and leaves other text alone', () => {
    expect(expandCommand('/alpha:review src/a.ts', commands)).toBe('Review: src/a.ts')
    expect(expandCommand('/alpha:review', commands)).toBe('Review:')
    expect(expandCommand('/alpha:plain now', commands)).toBe('Check the build\n\nnow')
    expect(expandCommand('/alpha:plain', commands)).toBe('Check the build')
    expect(expandCommand('/unknown x', commands)).toBeUndefined()
    expect(expandCommand('hello', commands)).toBeUndefined()
  })
})
