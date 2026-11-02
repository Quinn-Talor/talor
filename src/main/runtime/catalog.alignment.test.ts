// 能力目录与旧路径对齐（A1b AC-010）：用旧路径真实的 AgentManager / Agent 装配同一组 agent，
// 逐个比较旧路径给出的能力集合与 catalogSnapshot().select(profile)。
// 有意的差异写成断言：Feature 工具不再被内置工具白名单挡掉（T5）；委托目标不含自己。

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { BUILTIN_TOOL_NAMES, type AgentProfile } from '@shared/types/agent'
import { AgentManager } from '../agent/agent-manager'
import { BuiltinToolRegistry } from '../agent/builtin-registry'
import type { DelegationRuntime } from '../agent/delegate-agent'
import type { Agent } from '../agent/agent'
import type { MCPServer } from '../repos/mcp-server-repo'
import { SkillRegistry } from '../skills/registry'
import '../tools/builtin'
import { toolRegistry } from '../tools/registry'
import type { ToolDefinition } from '../tools/types'
import {
  catalogSnapshot,
  createCatalogRegistry,
  talorCatalogSources,
  type CatalogSnapshot,
} from './catalog'

const AT = '2026-01-01T00:00:00.000Z'
const SERVERS: MCPServer[] = [
  {
    id: 'm1',
    name: 'github',
    type: 'stdio',
    command: 'npx',
    enabled: true,
    created_at: AT,
    updated_at: AT,
  },
  {
    id: 'm2',
    name: 'notion',
    type: 'http',
    url: 'https://n.example.com',
    enabled: true,
    created_at: AT,
    updated_at: AT,
  },
  {
    id: 'm3',
    name: 'legacy',
    type: 'stdio',
    command: 'npx',
    enabled: false,
    created_at: AT,
    updated_at: AT,
  },
]
const CONNECTED = SERVERS.filter((s) => s.enabled).map((s) => s.name)

/** 旧路径的平台 MCP 注册表：只含连上的（启用的）服务器；按名字过滤得到视图。 */
interface McpView {
  names: string[]
  listRegisteredTools(): []
}
const platformMcp = {
  listRegisteredTools: () => [],
  execute: async () => ({ output: '' }),
  filterByServerNames: (names: string[]): McpView => ({ names, listRegisteredTools: () => [] }),
}

const investQuote: ToolDefinition = {
  name: 'invest_quote',
  description: 'quote',
  parameters: { type: 'object' },
  execute: async () => ({ output: 'q' }),
}

function profile(id: string, extra: Partial<AgentProfile> = {}): AgentProfile {
  return { id, name: id, description: `${id} agent`, agentPrompt: `${id} prompt`, ...extra }
}

const BUSINESS: AgentProfile[] = [
  profile('plain'),
  profile('scoped', {
    tools: ['bash'],
    mcpServers: ['github', 'legacy', 'nope'],
    skills: ['lark-doc', 'missing'],
    subagents: { ids: ['plain', 'ghost', '__chat__'].map((id) => ({ id, required: false })) },
  }),
  profile('open', {
    subagents: { allowAny: true, ids: [{ id: 'plain', required: false }] },
    mcpServers: [],
  }),
]
const FEATURE = profile('feat', { tools: ['read'] })

let skillsDir: string
let manager: AgentManager
let snapshot: CatalogSnapshot

beforeAll(() => {
  skillsDir = mkdtempSync(join(tmpdir(), 'catalog-skills-'))
  for (const name of ['lark-doc', 'pdf']) {
    mkdirSync(join(skillsDir, name))
    writeFileSync(
      join(skillsDir, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`,
    )
  }
  const skillRegistry = SkillRegistry.fromPlatformDir(skillsDir)
  expect(skillRegistry.listNames().sort()).toEqual(['lark-doc', 'pdf'])

  manager = new AgentManager()
  manager.init({
    builtinRegistry: new BuiltinToolRegistry(toolRegistry.listAll()),
    mcpRegistry: platformMcp as unknown as Parameters<AgentManager['init']>[0]['mcpRegistry'],
    skillRegistry,
    delegationRuntime: { agentManager: manager } as unknown as DelegationRuntime,
  })
  for (const p of BUSINESS) manager.reloadUserAgent(p, join(skillsDir, p.id))
  manager.registerFeatureAgent(FEATURE, [investQuote])

  // 目录由登记表组装：Talor 核心来源，再加 Feature 登记的来源（B1）
  const registry = createCatalogRegistry()
  registry.register('talor', { ...talorCatalogSources(manager), mcpServers: () => SERVERS })
  registry.register('feature:feat', {
    agents: () => [{ profile: FEATURE, featureTools: [investQuote] }],
  })
  snapshot = catalogSnapshot(registry.sources())
})

afterAll(() => {
  rmSync(skillsDir, { recursive: true, force: true })
})

const BUILTIN = new Set<string>(BUILTIN_TOOL_NAMES)
const sorted = (xs: string[]) => [...xs].sort()

/** 旧路径给这个 agent 的四类能力（注册层面）与暴露给模型的 Feature 工具。 */
function legacy(agent: Agent) {
  const exposed = agent.toolRegistry.listBuiltinTools().map((t) => t.name)
  const mcp =
    agent.mcpRegistry === (platformMcp as unknown)
      ? CONNECTED
      : (agent.mcpRegistry as unknown as McpView).names.filter((n) => CONNECTED.includes(n))
  const delegates = (agent.allowedAgentIds ?? manager.listBusinessAgentIds()).filter(
    (id) => manager.getAgent(id) !== null && !id.startsWith('__') && id !== agent.id,
  )
  return {
    builtins: sorted(exposed.filter((n) => BUILTIN.has(n))),
    skills: sorted(agent.skillRegistry.listNames()),
    mcpServers: sorted(mcp),
    delegates: sorted(delegates),
    featureToolsExposed: exposed.filter((n) =>
      (agent.id === FEATURE.id ? [investQuote] : []).some((t) => t.name === n),
    ),
  }
}

function current(p: AgentProfile) {
  const caps = snapshot.select(p)
  return {
    builtins: sorted(caps.builtins.map((t) => t.name)),
    skills: sorted(caps.skills.map((s) => s.metadata.name)),
    mcpServers: sorted(caps.mcpServers.map((e) => e.name)),
    delegates: sorted(caps.delegates.map((d) => d.id)),
    featureTools: caps.featureTools.map((t) => t.name),
  }
}

describe('catalog aligns with the legacy agent assembly (AC-010)', () => {
  const ids = ['__chat__', '__crystallizer__', 'plain', 'scoped', 'open', 'feat']

  it.each(ids)('AC-010 %s gets the same builtins, skills, MCP servers and delegates', (id) => {
    const agent = manager.getAgent(id)!
    const before = legacy(agent)
    const after = current(agent.profile)
    expect(after.builtins).toEqual(before.builtins)
    expect(after.skills).toEqual(before.skills)
    expect(after.mcpServers).toEqual(before.mcpServers)
    expect(after.delegates).toEqual(before.delegates)
    // Feature 工具：新集合是全部，旧路径暴露的是它的子集
    for (const name of before.featureToolsExposed) expect(after.featureTools).toContain(name)
  })

  it('AC-010 the matrix covers each selection rule', () => {
    expect(current(profile('__chat__', { subagents: { allowAny: true } })).delegates).toEqual([
      'feat',
      'open',
      'plain',
      'scoped',
    ])
    expect(current(BUSINESS[1]!)).toMatchObject({
      builtins: ['bash', 'glob', 'grep', 'ls', 'read'],
      skills: ['lark-doc'],
      mcpServers: ['github'],
      delegates: ['plain'],
    })
    expect(snapshot.select(BUSINESS[1]!).missing).toEqual({
      mcpServers: ['legacy', 'nope'],
      skills: ['missing'],
      subagents: ['ghost', '__chat__'],
    })
    expect(current(BUSINESS[2]!)).toMatchObject({
      mcpServers: ['github', 'notion'],
      delegates: ['feat', 'plain', 'scoped'],
    })
    expect(current(manager.getAgent('__crystallizer__')!.profile)).toMatchObject({
      builtins: ['glob', 'grep', 'ls', 'read'],
      skills: ['lark-doc', 'pdf'],
      delegates: [],
    })
  })

  it('AC-010 no longer hides feature tools behind the builtin tool list (T5)', () => {
    expect(legacy(manager.getAgent('feat')!).featureToolsExposed).toEqual([])
    expect(current(FEATURE).featureTools).toEqual(['invest_quote'])
  })
})
