// src/main/prompt/plugins/AgentPromptPlugin.test.ts — Schema 1.0 template-driven tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentPromptPlugin } from './AgentPromptPlugin'
import { Agent } from '../../agent/agent'
import { BuiltinToolRegistry } from '../../agent/builtin-registry'
import { SkillRegistry } from '../../skills/registry'
import type { PipelineContext } from '../types'
import type { AgentProfile } from '@shared/types/agent'
import type { ToolDefinition } from '../../tools/types'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ output: name }),
  }
}

const builtinRegistry = new BuiltinToolRegistry([
  makeTool('read'),
  makeTool('write'),
  makeTool('bash'),
])

function createAgent(profile: AgentProfile, skillRegistry?: SkillRegistry): Agent {
  return new Agent({
    profile,
    source: null,
    builtinRegistry,
    mcpRegistry: null,
    skillRegistry: skillRegistry ?? SkillRegistry.fromDir(null),
  })
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
  schemaVersion: '1.0',
  identity: { id: '__chat__', name: 'Talor', description: 'Default assistant', version: '0.2.0' },
  mission: { objective: 'Help with any task', outcomes: [] },
  method: { capabilities: ['General help'] },
  delivery: { deliverables: [], acceptance: [] },
  execution: {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

const REVIEWER: AgentProfile = {
  schemaVersion: '1.0',
  identity: { id: 'reviewer', name: 'Code Reviewer', description: 'Reviews PRs', version: '1.0.0' },
  mission: {
    objective: 'Produce structured PR review',
    outcomes: [
      {
        id: 'review_done',
        description: 'review report ready',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'review_report',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
      {
        id: 'extra_polish',
        description: 'good wording',
        priority: 'auxiliary',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'review_report',
            kind: 'deterministic',
            severity: 'should',
          },
        ],
      },
    ],
    inputs: [
      {
        id: 'pr_url',
        description: 'Pull request URL',
        type: 'text',
        required: true,
        examples: ['https://github.com/x/y/pull/1'],
      },
    ],
  },
  method: {
    capabilities: ['Apply standards review'],
    knowledge: [
      {
        type: 'file',
        path: 'rules.md',
        description: 'engineering rules',
        required: true,
        format: 'markdown',
      },
      { type: 'text', content: 'blocker = must-fix-before-merge', description: 'glossary' },
    ],
    workflow: {
      steps: [
        { id: 'load_ctx', description: 'Load standards', inputs: ['user-input'], produces: 'ctx' },
        {
          id: 'analyze',
          description: 'Walk diff',
          inputs: ['ctx'],
          produces: 'review_report',
          requires: ['load_ctx'],
        },
      ],
    },
    tools: [
      { name: 'read', required: true },
      { name: 'bash', disabled: true },
    ],
  },
  delivery: {
    deliverables: [
      {
        id: 'review_report',
        format: 'json',
        schema: {
          type: 'object',
          required: ['summary'],
          properties: { summary: { type: 'string' } },
        },
        rubric: ['✓ Each finding cites a line range', "✗ Don't list nits with blockers"],
      },
    ],
    acceptance: [
      {
        type: 'deliverable-present',
        deliverableId: 'review_report',
        kind: 'deterministic',
        severity: 'must',
      },
      { type: 'tool-was-used', toolName: 'read', kind: 'deterministic', severity: 'must' },
      { type: 'tool-not-used', toolName: 'write', kind: 'deterministic', severity: 'must' },
      {
        type: 'verifier-tool',
        toolName: 'check_quality',
        kind: 'deterministic',
        severity: 'should',
      },
    ],
  },
  execution: {
    limits: { maxSteps: 30, maxTokens: 100000 },
    retryPolicy: { maxAttempts: 2, onMustFail: 'retry-then-mark', onShouldFail: 'mark-only' },
  },
}

const plugin = new AgentPromptPlugin()

describe('AgentPromptPlugin (schema 1.0 template-driven)', () => {
  it('returns empty messages without agent', async () => {
    const r = await plugin.build(createContext())
    expect(r.messages).toEqual([])
    expect(r.tokenEstimate).toBe(0)
  })

  it('renders identity for any agent', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('You are **Code Reviewer**')
    expect(c).toContain('Reviews PRs')
  })

  it('AC-046: __chat__ does NOT render Mission/Acceptance/Quality Pledges/Deliverables', async () => {
    const agent = createAgent(PLATFORM_CHAT)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).not.toContain('# Mission')
    expect(c).not.toContain('# ⚠️ Acceptance Criteria')
    expect(c).not.toContain('# Quality Pledges')
    expect(c).not.toContain('# Deliverables')
  })

  it('AC-040: business agent renders Mission with [CORE] and [AUXILIARY] sections', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Mission')
    expect(c).toContain('[CORE — Required]')
    expect(c).toContain('[AUXILIARY — Nice to have]')
    expect(c).toContain('review_done')
    expect(c).toContain('extra_polish')
  })

  it('AC-041: workflow displays inputs → produces', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('Recommended workflow')
    expect(c).toContain('load_ctx')
    expect(c).toContain('Inputs:')
    expect(c).toContain('Produces:')
    expect(c).toContain('`user-input`')
    expect(c).toContain('`ctx`')
  })

  it('AC-042: acceptance section uses ⚠️ + REJECTED tone, must/should grouped', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# ⚠️ Acceptance Criteria (REQUIRED)')
    expect(c).toContain('REJECTED')
    expect(c).toContain('Nice-to-have (recorded but not blocking)')
    expect(c).toContain('did NOT call the "write" tool')
  })

  it('AC-043: rubric promoted to standalone Quality Pledges section', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Quality Pledges')
    expect(c).toContain('✓ Each finding cites a line range')
    expect(c).toContain("✗ Don't list nits with blockers")
  })

  it('AC-044: self-check section has 6 items (or 7 with inputs)', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Self-Check Before Responding')
    expect(c).toMatch(/Step location/)
    expect(c).toMatch(/Mission alignment/)
    expect(c).toMatch(/Required reading/)
    expect(c).toMatch(/Required tools/)
    expect(c).toMatch(/Deliverable/)
    expect(c).toMatch(/Quality Pledges/)
    // 7th item only when hasInputs
    expect(c).toMatch(/Inputs:/)
  })

  it('AC-045: required knowledge file is marked REQUIRED', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Reference Files')
    expect(c).toContain('rules.md')
    expect(c).toContain('REQUIRED — must read before producing deliverable')
  })

  it('AC-049: Required Inputs section renders for business agent with inputs', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Required Inputs (collect before starting)')
    expect(c).toContain('pr_url')
    expect(c).toContain('REQUIRED')
    expect(c).toContain('https://github.com/x/y/pull/1')
    // self-check item 7
    expect(c).toMatch(/7\.\s+\*\*Inputs\*\*/)
  })

  it('AC-049 negative: __chat__ has no Required Inputs section', async () => {
    const agent = createAgent(PLATFORM_CHAT)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).not.toContain('Required Inputs')
  })

  it('AC-022 implicit acceptance shows knowledge path in must list', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('You read "rules.md" at least once')
  })

  it('inline knowledge text renders in Domain Knowledge section', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    const c = (r.messages[0] as { role: string; content: string }).content
    expect(c).toContain('# Domain Knowledge')
    expect(c).toContain('blocker = must-fix-before-merge')
  })

  it('returns non-zero token estimate', async () => {
    const agent = createAgent(REVIEWER)
    const r = await plugin.build(createContext(agent))
    expect(r.tokenEstimate).toBeGreaterThan(50)
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
      const agent = createAgent(REVIEWER, reg)
      const r = await plugin.build(createContext(agent))
      const c = (r.messages[0] as { role: string; content: string }).content
      expect(c).toContain('## Available Skills')
      expect(c).toMatch(/- lark-doc/)
      expect(c).toContain('When to use: 触发短语')
    })

    it('omits Available Skills when registry empty', async () => {
      const agent = createAgent(REVIEWER)
      const r = await plugin.build(createContext(agent))
      const c = (r.messages[0] as { role: string; content: string }).content
      expect(c).not.toContain('## Available Skills')
    })
  })
})
