// src/main/agent/dependency-checker.test.ts — Schema 1.0 tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { checkDependencies } from './dependency-checker'
import type { AgentProfile } from '@shared/types/agent'

let tempDir: string

const BASE_PROFILE: AgentProfile = {
  schemaVersion: '1.0',
  identity: {
    id: 'test_agent',
    name: 'Test',
    description: 'Test agent',
    version: '1.0.0',
  },
  mission: {
    objective: 'Test',
    outcomes: [
      {
        id: 'done',
        description: 'work',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'r',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  },
  method: { capabilities: ['test'] },
  delivery: {
    deliverables: [{ id: 'r', format: 'markdown', mustContain: ['x'] }],
  },
  execution: {
    limits: { maxSteps: 10, maxTokens: 10000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

function withMethod(extra: Partial<AgentProfile['method']>): AgentProfile {
  return { ...BASE_PROFILE, method: { ...BASE_PROFILE.method, ...extra } }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dep-check-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('checkDependencies (schema 1.0)', () => {
  it('all pass for minimal profile', () => {
    const result = checkDependencies(BASE_PROFILE, tempDir, { appVersion: '1.0.0' })
    expect(result.passed).toBe(true)
    expect(result.steps.every((s) => s.status === 'pass')).toBe(true)
  })

  it('minAppVersion fail', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      identity: { ...BASE_PROFILE.identity, minAppVersion: '99.0.0' },
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '0.2.0' })
    expect(result.passed).toBe(false)
    const step = result.steps.find((s) => s.step === 'minAppVersion')!
    expect(step.status).toBe('fail')
    expect(step.message).toContain('99.0.0')
  })

  it('minAppVersion pass', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      identity: { ...BASE_PROFILE.identity, minAppVersion: '0.1.0' },
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'minAppVersion')!
    expect(step.status).toBe('pass')
  })

  it('missing required knowledge file', () => {
    const profile = withMethod({
      knowledge: [
        {
          type: 'file',
          path: './knowledge/manual.md',
          description: 'Manual',
          required: true,
          format: 'markdown',
        },
      ],
    })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    expect(result.passed).toBe(false)
    const step = result.steps.find((s) => s.step === 'knowledge')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('manual.md')
  })

  it('knowledge file exists → pass', () => {
    mkdirSync(join(tempDir, 'knowledge'), { recursive: true })
    writeFileSync(join(tempDir, 'knowledge', 'manual.md'), '# Manual')
    const profile = withMethod({
      knowledge: [
        {
          type: 'file',
          path: './knowledge/manual.md',
          description: 'Manual',
          required: true,
          format: 'markdown',
        },
      ],
    })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'knowledge')!
    expect(step.status).toBe('pass')
  })

  it('text knowledge ignored (no path check)', () => {
    const profile = withMethod({
      knowledge: [{ type: 'text', content: 'inline glossary', description: 'g' }],
    })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'knowledge')!
    expect(step.status).toBe('pass')
  })

  it('missing skill → missing status', () => {
    const profile = withMethod({
      skills: [{ name: 'missing-skill', required: true }],
    })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'skill')!
    expect(step.status).toBe('missing')
    expect(step.details).toContain('missing-skill')
  })

  it('skill exists → pass', () => {
    const skillDir = join(tempDir, 'skills', 'my-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: my-skill\n---\n# content')
    const profile = withMethod({
      skills: [{ name: 'my-skill', required: true }],
    })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'skill')!
    expect(step.status).toBe('pass')
  })

  it('MCP Server auth missing → missing', () => {
    const profile = withMethod({
      mcpServers: [
        {
          name: 'company-api',
          transport: {
            type: 'http',
            url: 'https://mcp.company.com',
            auth: { type: 'bearer', envVar: 'COMPANY_API_TOKEN' },
          },
          tools: ['search_orders'],
          required: true,
        },
      ],
    })
    const result = checkDependencies(profile, tempDir, {
      appVersion: '1.0.0',
      accountValues: new Map(),
    })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('COMPANY_API_TOKEN')
  })

  it('MCP Server auth configured → pass', () => {
    const profile = withMethod({
      mcpServers: [
        {
          name: 'company-api',
          transport: {
            type: 'http',
            url: 'https://mcp.company.com',
            auth: { type: 'bearer', envVar: 'COMPANY_API_TOKEN' },
          },
          tools: ['search_orders'],
          required: true,
        },
      ],
    })
    const result = checkDependencies(profile, tempDir, {
      appVersion: '1.0.0',
      accountValues: new Map([['COMPANY_API_TOKEN', 'tok_xxx']]),
    })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('pass')
  })

  // v8.1: ToolDependency.name 已 narrow 到 BuiltinToolName,非内置工具在编译期拒绝。
  // dependency-checker 仅校验声明的内置工具是否存在(永远 pass)。
  it('builtin tool in whitelist → pass', () => {
    const profile = withMethod({ tools: [{ name: 'bash', required: true }] })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'tool')!
    expect(step.status).toBe('pass')
  })

  it('disabled tool does not trigger missing', () => {
    const profile = withMethod({
      tools: [{ name: 'bash', required: true, disabled: true }],
    })
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'tool')!
    expect(step.status).toBe('pass')
  })

  describe('subagent dependency check (collaboration field path)', () => {
    it('missing required subagent', () => {
      const profile = withMethod({
        collaboration: { subagents: [{ id: 'B', required: true }] },
      })
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(['A', 'C']),
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('missing')
      expect(step.message).toContain('B')
    })

    it('all required subagents are registered', () => {
      const profile = withMethod({
        collaboration: {
          subagents: [
            { id: 'A', required: true },
            { id: 'B', required: true },
          ],
        },
      })
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(['A', 'B', 'C']),
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })

    it('non-required subagent missing → still pass', () => {
      const profile = withMethod({
        collaboration: { subagents: [{ id: 'optional-helper', required: false }] },
      })
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(),
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })

    it('skip subagent check when registeredBusinessAgents not provided', () => {
      const profile = withMethod({
        collaboration: { subagents: [{ id: 'B', required: true }] },
      })
      const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })
  })
})
