import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import log from 'electron-log'
import type { Agent } from 'agent-engine'
import type { AgentProfile } from '@shared/types/agent'
import type { MCPServer } from '../repos/mcp-server-repo'
import type { ParsedSkill } from '../skills/types'
import '../tools/builtin'
import { toolRegistry } from '../tools/registry'
import type { ToolDefinition } from '../tools/types'
import {
  agentFor,
  agentNameOf,
  delegateDescriptionOf,
  ENGINE_CHAT_PROMPT,
  engineAgentId,
  instructionsOf,
  MAX_DELEGATION_DEPTH,
  skillPackageOf,
} from './agents'
import { catalogSnapshot, type CatalogSources } from './catalog'

const snapshotOf = (overrides: Partial<CatalogSources> = {}) =>
  catalogSnapshot({
    builtins: () => toolRegistry.listAll(),
    mcpServers: () => [],
    skills: () => [],
    agents: () => [],
    ...overrides,
  })

const SNAPSHOT = snapshotOf()

const profile = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: '__chat__',
  name: 'Talor',
  description: 'chat',
  agentPrompt: 'You are Talor.',
  ...overrides,
})

const toolNames = (agent: Agent) =>
  (agent.capabilities ?? []).flatMap(
    (c) => ((c.config as { tools?: string[] } | undefined)?.tools ?? []) as string[],
  )

describe('agentFor', () => {
  it('AC-009 uses the agent prompt as the instructions', () => {
    const agent = agentFor(profile({ id: 'market' }), SNAPSHOT)
    expect(agent.id).toBe('market')
    expect(agent.instructions).toEqual([
      { role: 'system', parts: [{ type: 'text', text: 'You are Talor.' }] },
    ])
  })

  it('AC-009 gives every builtin tool when the profile declares none', () => {
    expect(toolNames(agentFor(profile(), SNAPSHOT)).sort()).toEqual(
      ['bash', 'edit', 'glob', 'grep', 'ls', 'read', 'write'].sort(),
    )
  })

  it('AC-009 adds the read-only tools to a declared tool list', () => {
    const agent = agentFor(profile({ id: 'b', tools: ['bash'] }), SNAPSHOT)
    expect(toolNames(agent).sort()).toEqual(['bash', 'glob', 'grep', 'ls', 'read'].sort())
  })

  it('AC-009 maps profile ids to the engine id format', () => {
    expect(engineAgentId('market-analyst')).toBe('market-analyst')
    expect(engineAgentId('__chat__')).toBe('talor__chat__')
    expect(engineAgentId('-x')).toBe('talor-x')
    expect(engineAgentId('有中文')).toMatch(/^talor-[0-9a-f]{16}$/)
  })

  it('AC-009 reuses the agent for the same profile and rebuilds it when the prompt changes', () => {
    const first = agentFor(profile({ id: 'c' }), SNAPSHOT)
    expect(agentFor(profile({ id: 'c' }), SNAPSHOT)).toBe(first)
    const changed = agentFor(profile({ id: 'c', agentPrompt: 'Different.' }), SNAPSHOT)
    expect(changed).not.toBe(first)
    expect(changed.fingerprint).not.toBe(first.fingerprint)
  })

  it('AC-011 takes the builtin tools from the catalog', () => {
    const noWrite = snapshotOf({
      builtins: () => toolRegistry.listAll().filter((t) => t.name !== 'write'),
    })
    const p = profile({ id: 'd' })
    expect(toolNames(agentFor(p, noWrite)).sort()).toEqual(
      noWrite
        .select(p)
        .builtins.map((t) => t.name)
        .sort(),
    )
    expect(toolNames(agentFor(p, noWrite))).not.toContain('write')
  })

  it('AC-011 reuses the agent within a catalog version and rebuilds it for a new one', () => {
    const p = profile({ id: 'e' })
    const first = agentFor(p, SNAPSHOT)
    expect(agentFor(p, snapshotOf())).toBe(first)
    const other = snapshotOf({ builtins: () => toolRegistry.listAll().slice(1) })
    expect(other.version).not.toBe(SNAPSHOT.version)
    expect(agentFor(p, other)).not.toBe(first)
  })
})

const AT = '2026-01-01T00:00:00.000Z'
const server = (id: string, name: string): MCPServer => ({
  id,
  name,
  type: 'stdio',
  command: 'npx',
  args: [name],
  enabled: true,
  created_at: AT,
  updated_at: AT,
})

const parsedSkill = (
  name: string,
  extra: Partial<ParsedSkill['metadata']> = {},
  content = `# ${name}`,
): ParsedSkill => ({
  metadata: { name, description: `${name} skill`, ...extra },
  content,
  filePath: `/s/${name}/SKILL.md`,
})

const capabilityIds = (agent: Agent) => (agent.capabilities ?? []).map((c) => c.id)

describe('agentFor assembles every capability (A2)', () => {
  const snapshot = snapshotOf({
    mcpServers: () => [server('m1', 'github'), server('m2', 'notion')],
    skills: () => [parsedSkill('lark-doc'), parsedSkill('pdf')],
    agents: () => [
      {
        profile: profile({ id: 'feat', tools: ['read'] }),
        featureTools: [
          {
            name: 'invest_quote',
            description: 'quote',
            parameters: { type: 'object' },
            execute: async () => ({ output: 'q' }),
          } as ToolDefinition,
        ],
      },
    ],
  })

  it('AC-001 adds one MCP capability per selected server with its catalog spec', () => {
    const all = agentFor(profile({ id: 'a1' }), snapshot)
    const mcps = (all.capabilities ?? []).filter((c) => c.kind === 'mcp')
    expect(mcps.map((c) => c.id)).toEqual(['mcp:github', 'mcp:notion'])
    expect(mcps[0]!.config).toEqual(JSON.parse(JSON.stringify(snapshot.mcpServers[0]!.spec)))
    const scoped = agentFor(profile({ id: 'a2', mcpServers: ['notion'] }), snapshot)
    expect(capabilityIds(scoped).filter((id) => id.startsWith('mcp:'))).toEqual(['mcp:notion'])
  })

  it('AC-002 turns a parsed skill into an engine skill package', () => {
    const lark = parsedSkill(
      'lark-doc',
      { when_to_use: '写飞书文档时' },
      '见 [参考](refs/a.md) 与 [外链](https://x)',
    )
    const pkg = skillPackageOf(lark)
    expect(pkg).toMatchObject({
      name: 'lark-doc',
      description: 'lark-doc skill。使用时机：写飞书文档时',
      content: '见 [参考](/s/lark-doc/refs/a.md) 与 [外链](https://x)',
      dir: '/s/lark-doc',
    })
    expect(skillPackageOf(parsedSkill('pdf')).description).toBe('pdf skill')
    expect(skillPackageOf(lark).hash).toBe(pkg.hash)
    expect(skillPackageOf({ ...lark, content: 'changed' }).hash).not.toBe(pkg.hash)

    const platform = agentFor(profile({ id: '__crystallizer__' }), snapshot)
    expect(capabilityIds(platform)).toEqual(expect.arrayContaining(['skill:lark-doc', 'skill:pdf']))
  })

  it('AC-003 adds the feature tools as their own capability', () => {
    const feat = agentFor(snapshot.agents[0]!.profile, snapshot)
    const featureCap = (feat.capabilities ?? []).find((c) => c.id === 'feature:feat')
    expect((featureCap?.config as { tools?: string[] }).tools).toEqual(['invest_quote'])
    expect(capabilityIds(agentFor(profile({ id: 'a3' }), snapshot))).not.toContain('feature:a3')
    expect(capabilityIds(feat)[0]).toBe('builtin')
  })

  it('AC-004 gives __chat__ the goal-driven engine prompt and keeps business prompts', () => {
    expect(instructionsOf(profile({ id: '__chat__', agentPrompt: 'legacy' }))).toBe(
      ENGINE_CHAT_PROMPT,
    )
    for (const name of ['search_tool', 'delegate_agent', 'activate_skill', 'mcp__']) {
      expect(ENGINE_CHAT_PROMPT).not.toContain(name)
    }
    // F24 AC-007：被拒绝后不换做法绕过
    expect(ENGINE_CHAT_PROMPT).toContain('do not try to achieve the same thing another way')
    const chat = agentFor(profile({ agentPrompt: 'legacy chat prompt' }), snapshot)
    expect(chat.instructions).toEqual([
      { role: 'system', parts: [{ type: 'text', text: ENGINE_CHAT_PROMPT }] },
    ])
    expect(instructionsOf(profile({ id: 'biz', agentPrompt: 'Biz.' }))).toBe('Biz.')
  })

  it('AC-005 logs missing references once when the agent is built', () => {
    const warn = vi.mocked(log.warn)
    warn.mockClear()
    const p = profile({ id: 'needy', mcpServers: ['nope'], skills: ['missing'] })
    agentFor(p, snapshot)
    agentFor(p, snapshot)
    expect(warn).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(warn.mock.calls[0])
    for (const part of ['needy', 'nope', 'missing']) expect(text).toContain(part)
    expect(text).not.toContain('subagents')

    warn.mockClear()
    agentFor(profile({ id: 'fine', skills: ['pdf'] }), snapshot)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('agentFor delegation (A4 TASK-1)', () => {
  const helper = profile({ id: 'helper', name: 'Helper', description: '\n helps with notes\nmore' })
  const other = profile({ id: 'other', name: 'Other', description: '' })
  const chat = profile({ subagents: { allowAny: true } })
  const snapshot = snapshotOf({
    agents: () => [
      { profile: helper, featureTools: [] },
      { profile: other, featureTools: [] },
    ],
  })
  const subagentCaps = (agent: Agent) =>
    (agent.capabilities ?? []).filter((c) => c.id.startsWith('subagent:'))
  const budgetOf = (agent: Agent, id: string) =>
    (subagentCaps(agent).find((c) => c.id === id)?.config as { budget?: unknown }).budget

  it('AC-001 adds one subagent per delegate with the root budget and a description', () => {
    expect(MAX_DELEGATION_DEPTH).toBe(3)
    const agent = agentFor(chat, snapshot)
    expect(subagentCaps(agent).map((c) => c.id)).toEqual(['subagent:helper', 'subagent:other'])
    expect(budgetOf(agent, 'subagent:helper')).toEqual({ maxTotalMs: 1800000 })
    expect(
      budgetOf(agentFor(chat, snapshot, { childTimeoutMs: 60000 }), 'subagent:helper'),
    ).toEqual({
      maxTotalMs: 60000,
    })
    expect(delegateDescriptionOf(helper)).toBe('Helper：helps with notes')
    expect(delegateDescriptionOf(other)).toBe('Other')
    expect(
      delegateDescriptionOf(profile({ name: 'X', description: 'y'.repeat(300) })),
    ).toHaveLength(200)
  })

  it('AC-002 gives deeper agents no budget and stops delegating at depth 3', () => {
    for (const depth of [1, 2]) {
      const agent = agentFor(chat, snapshot, { depth })
      expect(subagentCaps(agent).length).toBe(2)
      expect(budgetOf(agent, 'subagent:helper')).toBeNull()
    }
    expect(subagentCaps(agentFor(chat, snapshot, { depth: 3 }))).toEqual([])
  })

  it('AC-003 assembles mutual delegation finitely and caches by depth', () => {
    const a = profile({ id: 'a', name: 'A', subagents: { ids: [{ id: 'b', required: false }] } })
    const b = profile({ id: 'b', name: 'B', subagents: { ids: [{ id: 'a', required: false }] } })
    const mutual = snapshotOf({
      agents: () => [
        { profile: a, featureTools: [] },
        { profile: b, featureTools: [] },
      ],
    })
    const agent = agentFor(a, mutual)
    const sub = subagentCaps(agent).find((c) => c.id === 'subagent:b')!
    expect((sub.config as { fingerprint: string }).fingerprint).toBe(
      agentFor(b, mutual, { depth: 1 }).fingerprint,
    )
    expect(agentFor(a, mutual)).toBe(agent)
    expect(agentFor(a, mutual, { depth: 1 })).not.toBe(agent)
    expect(agentNameOf(engineAgentId('b'))).toBe('B')
  })
})

describe('agentFor intent tools (C2)', () => {
  const ids = (agent: Agent) => (agent.capabilities ?? []).map((c) => c.id)

  it('AC-001 adds the intents capability right after the builtin tools', () => {
    const platform = agentFor(profile({ id: 'c2-chat' }), SNAPSHOT)
    expect(ids(platform).slice(0, 2)).toEqual(['builtin', 'intents'])
    const business = agentFor(
      profile({ id: 'c2-biz', agentPrompt: 'biz', tools: ['read'] }),
      SNAPSHOT,
    )
    expect(ids(business).slice(0, 2)).toEqual(['builtin', 'intents'])
    const bare = agentFor(profile({ id: 'c2-bare' }), snapshotOf({ builtins: () => [] }))
    expect(ids(bare)[0]).toBe('intents')
  })
})
