// src/main/prompt/plugins/AgentPromptPlugin.test.ts — Schema 2.0 template-driven tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// Template-loader mock: default returns the real inlined template via _resetTemplateCache-compatible
// stub; individual tests can override forceEmpty to test the fallback path.
const templateLoaderState = vi.hoisted(() => ({ forceEmpty: false }))
vi.mock('../template-loader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../template-loader')>()
  return {
    ...real,
    loadAgentSystemPromptTemplate: () => {
      if (templateLoaderState.forceEmpty) return ''
      return real.loadAgentSystemPromptTemplate()
    },
    _resetTemplateCache: real._resetTemplateCache,
  }
})

import { AgentPromptPlugin, _resetTemplateCache } from './AgentPromptPlugin'
import { SkillRegistry } from '../../skills/registry'
import type { PipelineContext } from '../types'
import type { AgentProfile } from '@shared/types/agent'
import type { Agent } from '../../agent/agent'

// ── Minimal Agent stub.
// Agent constructor still uses 1.0 field paths (Phase 3 fixes that).
// buildRuntimeContext only reads profile.{name,description,agentPrompt,id,references} + skillRegistry.
function makeAgentStub(profile: AgentProfile, skillRegistry?: SkillRegistry): Agent {
  return { profile, skillRegistry: skillRegistry ?? SkillRegistry.fromDir(null) } as Agent
}

function createContext(agent?: Agent): PipelineContext {
  return {
    sessionId: 's',
    currentMessage: { text: 'go' },
    provider: {
      id: 'p',
      name: 'p',
      base_url: '',
      type: 'anthropic' as const,
      models: [],
      enabled: true,
      is_default: true,
      supports_vision: false,
      created_at: '',
      updated_at: '',
    },
    providerConfig: {
      provider: {
        id: 'p',
        name: 'p',
        base_url: '',
        type: 'anthropic' as const,
        models: [],
        enabled: true,
        is_default: true,
        supports_vision: false,
        created_at: '',
        updated_at: '',
      },
      context_limit: 8000,
      recent_ratio: 0.7,
      summary_ratio: 0.2,
    },
    workspacePath: '/tmp',
    agent,
  }
}

const PLATFORM_CHAT: AgentProfile = {
  id: '__chat__',
  name: 'Talor',
  description: 'Default AI assistant.',
  agentPrompt: 'Help the user with any task.',
}

const REVIEWER: AgentProfile = {
  id: 'reviewer',
  name: 'Code Reviewer',
  description: 'Reviews PRs and produces structured reports.',
  agentPrompt:
    '## Required Inputs\n- pr_url (REQUIRED): GitHub PR URL\n\n## Workflow\n1. Read rules\n2. Analyze diff\n\n## Output\nReturn a JSON review report.',
}

const plugin = new AgentPromptPlugin()

describe('AgentPromptPlugin (schema 2.0 template-driven)', () => {
  beforeEach(() => {
    _resetTemplateCache()
  })

  it('returns empty messages without agent', async () => {
    const r = await plugin.build(createContext())
    expect(r.messages).toEqual([])
    expect(r.tokenEstimate).toBe(0)
  })

  it('renders # Identity containing name and description', async () => {
    const agent = makeAgentStub(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Identity')
    expect(c).toContain('**Code Reviewer**')
    expect(c).toContain('Reviews PRs and produces structured reports.')
  })

  it('agentPrompt content appears verbatim in output', async () => {
    const agent = makeAgentStub(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('## Required Inputs')
    expect(c).toContain('## Workflow')
    expect(c).toContain('## Output')
    expect(c).toContain('Return a JSON review report.')
  })

  // References section 已删 — schema 不再有 references 字段

  it('criticalRoleConstraints appear after Identity for __chat__', async () => {
    const agent = makeAgentStub(PLATFORM_CHAT)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toMatch(/delegate/i)
  })

  it('criticalRoleConstraints absent for non-__chat__ agent', async () => {
    const agent = makeAgentStub(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).not.toMatch(/delegate_agent/i)
  })

  it('# Self-Check section always present', async () => {
    const agent = makeAgentStub(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Self-Check Before Responding')
  })

  it('returns non-zero token estimate', async () => {
    const agent = makeAgentStub(REVIEWER)
    const r = await plugin.build(createContext(agent))
    expect(r.tokenEstimate).toBeGreaterThan(10)
  })

  it('returns fallback identity string when template loader fails', async () => {
    templateLoaderState.forceEmpty = true
    try {
      const agent = makeAgentStub({
        id: 'fallback-test',
        name: 'FallbackAgent',
        description: 'For testing fallback.',
        agentPrompt: '',
      })
      const r = await plugin.build(createContext(agent))
      expect(r.messages).toHaveLength(1)
      expect((r.messages[0] as { role: string; content: string }).content).toContain(
        'You are "FallbackAgent"',
      )
      expect((r.messages[0] as { role: string; content: string }).content).toContain(
        'For testing fallback.',
      )
    } finally {
      templateLoaderState.forceEmpty = false
    }
  })

  describe('skill listing', () => {
    let skillTempDir: string

    beforeEach(() => {
      skillTempDir = mkdtempSync(join(tmpdir(), 'agent-prompt-skill-'))
    })

    afterEach(() => {
      rmSync(skillTempDir, { recursive: true, force: true })
    })

    function createSkillDir(name: string, description: string, whenToUse?: string): void {
      const dir = join(skillTempDir, name)
      mkdirSync(dir, { recursive: true })
      const whenLine = whenToUse ? `\nwhen_to_use: "${whenToUse}"` : ''
      writeFileSync(
        join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: "${description}"${whenLine}\n---\n\n# ${name}\ncontent`,
      )
    }

    it('renders Available Skills section when registry has skills', async () => {
      createSkillDir('lark-doc', '飞书云文档', '触发短语:飞书文档')
      const reg = SkillRegistry.fromDir(skillTempDir)
      const agent = makeAgentStub(REVIEWER, reg)
      const r = await plugin.build(createContext(agent))
      const c = (r.messages[0] as { role: string; content: string }).content
      expect(c).toContain('## Available Skills')
      expect(c).toMatch(/- lark-doc/)
      expect(c).toContain('When to use: 触发短语')
    })

    it('omits Available Skills when registry empty', async () => {
      const agent = makeAgentStub(REVIEWER)
      const r = await plugin.build(createContext(agent))
      const c = (r.messages[0] as { role: string; content: string }).content
      expect(c).not.toContain('## Available Skills')
    })
  })
})
