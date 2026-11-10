// src/main/agent/agent-manager.test.ts — AgentManager：profile 注册表
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { AgentManager, CHAT_PROFILE } from './agent-manager'
import { persistAgentProfile } from './profile-fs'
import { SkillRegistry } from '../skills/registry'
import { agentFor } from '../runtime/agents'
import { catalogSnapshot } from '../runtime/catalog'
import type { AgentProfile } from '@shared/types/agent'

const BUSINESS_PROFILE: AgentProfile = {
  id: 'sales_001',
  name: '销售分析师',
  description: '汇总销售数据并生成报告。',
  agentPrompt: `## Workflow
1. Read sales data files.
2. Generate summary report.

## Principles
- Always cite data sources.

## Output
Markdown report with # Summary header.`,
  tools: ['bash'],
}

const FEATURE_PROFILE: AgentProfile = {
  id: 'invest_research',
  name: '投研主理人',
  description: '投研建卡与跟踪。',
  agentPrompt: `## Workflow
1. Build the card.

## Principles
- Cite sources.

## Output
Markdown card.`,
}

function freshManager(agentsDir?: string): AgentManager {
  const m = new AgentManager()
  m.init({ skillRegistry: SkillRegistry.fromDir(null), ...(agentsDir ? { agentsDir } : {}) })
  return m
}

describe('AgentManager stores profiles only', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-manager-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-001 platform agents and user agents are { profile, source }', () => {
    const agentDir = join(dir, 'sales_001')
    mkdirSync(agentDir)
    persistAgentProfile(BUSINESS_PROFILE, agentDir)
    const m = freshManager(dir)

    expect(m.isInitialized).toBe(true)
    expect(m.getAgent('__chat__')).toEqual({ profile: CHAT_PROFILE, source: null })
    const cryst = m.getAgent('__crystallizer__')!
    expect(cryst.source).toBeNull()
    expect(cryst.profile.agentPrompt).toContain('## Workflow')
    expect(Object.keys(cryst).sort()).toEqual(['profile', 'source'])
    const user = m.getAgent('sales_001')!
    expect(user.source).toBe(agentDir)
    expect(user.profile.id).toBe('sales_001')
    expect(m.listBusinessAgentIds()).toEqual(['sales_001'])
  })

  it('AC-001 register / reload / unregister replace the stored entry', () => {
    const m = freshManager()
    const entry = { profile: BUSINESS_PROFILE, source: '/d' }
    expect(m.registerBusinessAgent('u', entry)).toBe(entry)
    expect(m.getAgent('u')).toBe(entry)

    const reloaded = m.reloadUserAgent({ ...BUSINESS_PROFILE, name: 'new' }, '/e')
    expect(m.getAgent('sales_001')).toEqual(reloaded)
    expect(reloaded).toEqual({ profile: { ...BUSINESS_PROFILE, name: 'new' }, source: '/e' })

    expect(m.unregisterBusinessAgent('u')).toBe(true)
    expect(m.unregisterBusinessAgent('u')).toBe(false)
    expect(m.getAgent('u')).toBeNull()
    expect(m.getAgent('nonexistent')).toBeNull()
  })

  it('getChatAgent throws if not initialized', () => {
    expect(() => new AgentManager().getChatAgent()).toThrow('AgentManager not initialized')
    expect(() => new AgentManager().registerBusinessAgent('x', entryOf())).toThrow()
  })
})

function entryOf() {
  return { profile: BUSINESS_PROFILE, source: null }
}

describe('__chat__ profile', () => {
  it('AC-002 the agentPrompt is the goal-driven prompt and the engine instruction', () => {
    const prompt = CHAT_PROFILE.agentPrompt
    expect(prompt).toContain('more tools are available than the ones listed')
    expect(prompt).toContain('do not try to achieve the same thing another way')
    expect(prompt).toContain('A denial covers the turn it happened in')
    // 不点名工具或具体服务
    for (const name of ['search_tool', 'delegate_agent', 'bash', 'MCP']) {
      expect(prompt).not.toContain(name)
    }
    expect(prompt).not.toMatch(/MySQL|PostgreSQL|GitHub|Slack|Notion/i)

    const snapshot = catalogSnapshot({
      builtins: () => [],
      mcpServers: () => [],
      skills: () => [],
      agents: () => [],
    })
    expect(agentFor(CHAT_PROFILE, snapshot).instructions).toEqual([
      { role: 'system', parts: [{ type: 'text', text: prompt }] },
    ])
  })
})

describe('AgentManager feature agents (内存自管,不落盘)', () => {
  it('registerFeatureAgent: 内存注册为业务 agent(source=null)', () => {
    const m = freshManager()
    m.registerFeatureAgent(FEATURE_PROFILE)

    expect(m.getAgent('invest_research')).toEqual({ profile: FEATURE_PROFILE, source: null })
    expect(m.listBusinessAgentIds()).toContain('invest_research')
    expect(m.getFeatureAgentProfiles().map((p) => p.id)).toEqual(['invest_research'])
  })

  it('fork-override: 同 id 已注册 → 跳过,不重复', () => {
    const m = freshManager()
    m.registerFeatureAgent(FEATURE_PROFILE)
    m.registerFeatureAgent(FEATURE_PROFILE)
    expect(m.getFeatureAgentProfiles()).toHaveLength(1)
  })

  it('B1 AC-003 featureAgentIds: Feature 承载的 id;被用户版覆盖、替换或注销后去掉', () => {
    const m = freshManager()
    m.registerFeatureAgent(FEATURE_PROFILE)
    expect([...m.featureAgentIds()]).toEqual(['invest_research'])

    // 用户 agent 先注册同 id → feature 被跳过,不算 Feature 承载
    const overridden = freshManager()
    overridden.reloadUserAgent({ ...FEATURE_PROFILE, id: 'u' }, '/tmp/u')
    overridden.registerFeatureAgent({ ...FEATURE_PROFILE, id: 'u' })
    expect(overridden.featureAgentIds().has('u')).toBe(false)

    // 之后被用户版替换(reload / registerBusinessAgent)或注销 → 去掉
    m.reloadUserAgent(FEATURE_PROFILE, '/tmp/invest')
    expect(m.featureAgentIds().has('invest_research')).toBe(false)
    const replaced = freshManager()
    replaced.registerFeatureAgent(FEATURE_PROFILE)
    replaced.registerBusinessAgent('invest_research', { profile: FEATURE_PROFILE, source: null })
    expect(replaced.featureAgentIds().has('invest_research')).toBe(false)
    const removed = freshManager()
    removed.registerFeatureAgent(FEATURE_PROFILE)
    removed.unregisterBusinessAgent('invest_research')
    expect(removed.featureAgentIds().has('invest_research')).toBe(false)
  })

  it('未 init 即调 registerFeatureAgent → 抛', () => {
    expect(() => new AgentManager().registerFeatureAgent(FEATURE_PROFILE)).toThrow()
  })

  it('不触发:无 feature 注册 → 只有平台 agent,无业务 agent(不抛)', () => {
    const m = freshManager()
    expect(m.listBusinessAgentIds()).toEqual([])
    expect(m.getAgent('__chat__')).not.toBeNull()
  })
})
