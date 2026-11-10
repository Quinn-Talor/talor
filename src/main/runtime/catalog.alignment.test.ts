// 能力目录的选择规则（A1b AC-010）：真实的 AgentManager 登记一组 agent，逐个断言
// catalogSnapshot().select(profile) 给出的能力集合（期望值即旧路径装配曾给出的集合，D2 删旧路径后固定下来）。
// Feature 工具不被内置工具白名单挡掉（T5）；委托目标不含自己。

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import type { AgentProfile } from '@shared/types/agent'
import { AgentManager } from '../agent/agent-manager'
import type { MCPServer } from '../repos/mcp-server-repo'
import { SkillRegistry } from '../skills/registry'
import '../tools/builtin'
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
  manager.init({ skillRegistry })
  for (const p of BUSINESS) manager.reloadUserAgent(p, join(skillsDir, p.id))
  manager.registerFeatureAgent(FEATURE)

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

const sorted = (xs: string[]) => [...xs].sort()
const ALL_BUILTINS = ['bash', 'edit', 'glob', 'grep', 'ls', 'read', 'write']

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

describe('catalog selection rules (AC-010)', () => {
  // 平台 agent 拿全部 skill；业务 agent 只拿声明的 skill（未声明为空）
  const SKILLS = ['lark-doc', 'pdf']
  it.each([
    [
      '__chat__',
      ALL_BUILTINS,
      SKILLS,
      ['github', 'notion'],
      ['feat', 'open', 'plain', 'scoped'],
      [],
    ],
    ['__crystallizer__', ['glob', 'grep', 'ls', 'read'], SKILLS, ['github', 'notion'], [], []],
    ['plain', ALL_BUILTINS, [], ['github', 'notion'], [], []],
    ['open', ALL_BUILTINS, [], ['github', 'notion'], ['feat', 'plain', 'scoped'], []],
    ['feat', ['glob', 'grep', 'ls', 'read'], [], ['github', 'notion'], [], ['invest_quote']],
  ])(
    'AC-010 %s gets its builtins, skills, MCP servers, delegates and feature tools',
    (id, builtins, skills, mcpServers, delegates, featureTools) => {
      expect(current(manager.getAgent(id)!.profile)).toEqual({
        builtins,
        skills,
        mcpServers,
        delegates,
        featureTools,
      })
    },
  )

  it('AC-010 the matrix covers each selection rule', () => {
    expect(current(BUSINESS[1]!)).toEqual({
      builtins: ['bash', 'glob', 'grep', 'ls', 'read'],
      skills: ['lark-doc'],
      mcpServers: ['github'],
      delegates: ['plain'],
      featureTools: [],
    })
    expect(snapshot.select(BUSINESS[1]!).missing).toEqual({
      mcpServers: ['legacy', 'nope'],
      skills: ['missing'],
      subagents: ['ghost', '__chat__'],
    })
  })
})
