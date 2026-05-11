// src/main/agent/dependency-checker.test.ts — Schema 2.0 tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { checkDependencies } from './dependency-checker'
import type { AgentProfile } from '@shared/types/agent'

let tempDir: string

const BASE_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: 'test_agent',
  name: 'Test',
  description: 'Test agent.',
  version: '1.0.0',
  agentPrompt: '## Workflow\n1. Do the thing.',
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dep-check-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('checkDependencies (schema 2.0)', () => {
  it('all pass for minimal profile', () => {
    const result = checkDependencies(BASE_PROFILE, tempDir, { appVersion: '1.0.0' })
    expect(result.passed).toBe(true)
    expect(result.steps.every((s) => s.status === 'pass')).toBe(true)
  })

  it('minAppVersion fail', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      minAppVersion: '99.0.0',
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
      minAppVersion: '0.1.0',
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'minAppVersion')!
    expect(step.status).toBe('pass')
  })

  it('missing reference file → missing status', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      references: [
        {
          id: 'manual',
          path: './knowledge/manual.md',
          description: 'Manual',
        },
      ],
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    expect(result.passed).toBe(false)
    const step = result.steps.find((s) => s.step === 'references')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('manual.md')
  })

  it('reference file exists → pass', () => {
    mkdirSync(join(tempDir, 'knowledge'), { recursive: true })
    writeFileSync(join(tempDir, 'knowledge', 'manual.md'), '# Manual')
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      references: [
        {
          id: 'manual',
          path: './knowledge/manual.md',
          description: 'Manual',
        },
      ],
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'references')!
    expect(step.status).toBe('pass')
  })

  it('missing skill → missing status', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      skills: [{ name: 'missing-skill', required: true }],
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'skill')!
    expect(step.status).toBe('missing')
    expect(step.details).toContain('missing-skill')
  })

  it('skill exists → pass', () => {
    const skillDir = join(tempDir, 'skills', 'my-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: my-skill\n---\n# content')
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      skills: [{ name: 'my-skill', required: true }],
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'skill')!
    expect(step.status).toBe('pass')
  })

  it('MCP Server auth missing → missing', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
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
    }
    const result = checkDependencies(profile, tempDir, {
      appVersion: '1.0.0',
      accountValues: new Map(),
    })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('COMPANY_API_TOKEN')
  })

  it('MCP Server auth configured → pass', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
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
    }
    const result = checkDependencies(profile, tempDir, {
      appVersion: '1.0.0',
      accountValues: new Map([['COMPANY_API_TOKEN', 'tok_xxx']]),
    })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('pass')
  })

  // v2.0: tools is BuiltinToolName[] whitelist (positive list)
  it('builtin tool in whitelist → pass', () => {
    const profile: AgentProfile = { ...BASE_PROFILE, tools: ['bash'] }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'tool')!
    expect(step.status).toBe('pass')
  })

  describe('subagent dependency check (v2.0: profile.subagents.ids)', () => {
    it('missing required subagent', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        subagents: { ids: [{ id: 'B', required: true }] },
      }
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(['A', 'C']),
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('missing')
      expect(step.message).toContain('B')
    })

    it('all required subagents are registered', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        subagents: {
          ids: [
            { id: 'A', required: true },
            { id: 'B', required: true },
          ],
        },
      }
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(['A', 'B', 'C']),
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })

    it('skip subagent check when registeredBusinessAgents not provided', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        subagents: { ids: [{ id: 'B', required: true }] },
      }
      const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })
  })
})
