import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { checkDependencies } from './dependency-checker'
import type { AgentProfile } from '@shared/types/agent'

let tempDir: string

const BASE_PROFILE: AgentProfile = {
  id: 'test-001',
  name: 'Test',
  description: 'Test agent',
  version: '1.0.0',
  role: { capabilities: ['test'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dep-check-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('checkDependencies', () => {
  it('all pass for minimal profile', () => {
    const result = checkDependencies(BASE_PROFILE, tempDir, { appVersion: '1.0.0' })
    expect(result.passed).toBe(true)
    expect(result.steps.every((s) => s.status === 'pass')).toBe(true)
  })

  it('AC-B2-01: minAppVersion fail', () => {
    const profile = { ...BASE_PROFILE, minAppVersion: '99.0.0' }
    const result = checkDependencies(profile, tempDir, { appVersion: '0.2.0' })
    expect(result.passed).toBe(false)
    const step = result.steps.find((s) => s.step === 'minAppVersion')!
    expect(step.status).toBe('fail')
    expect(step.message).toContain('99.0.0')
    expect(step.message).toContain('0.2.0')
  })

  it('minAppVersion pass', () => {
    const profile = { ...BASE_PROFILE, minAppVersion: '0.1.0' }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'minAppVersion')!
    expect(step.status).toBe('pass')
  })

  it('missing required knowledge file', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      knowledge: {
        files: [
          {
            path: './knowledge/manual.md',
            description: 'Manual',
            required: true,
            format: 'markdown',
          },
        ],
      },
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    expect(result.passed).toBe(false)
    const step = result.steps.find((s) => s.step === 'knowledge')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('manual.md')
  })

  it('knowledge file exists → pass', () => {
    mkdirSync(join(tempDir, 'knowledge'), { recursive: true })
    writeFileSync(join(tempDir, 'knowledge', 'manual.md'), '# Manual')

    const profile: AgentProfile = {
      ...BASE_PROFILE,
      knowledge: {
        files: [
          {
            path: './knowledge/manual.md',
            description: 'Manual',
            required: true,
            format: 'markdown',
          },
        ],
      },
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'knowledge')!
    expect(step.status).toBe('pass')
  })

  it('missing skill → missing status', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      dependencies: {
        ...BASE_PROFILE.dependencies,
        skills: [
          {
            source: { type: 'npx', uri: 'test/repo' },
            items: [{ name: 'missing-skill', required: true }],
          },
        ],
      },
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
      dependencies: {
        ...BASE_PROFILE.dependencies,
        skills: [{ source: { type: 'local' }, items: [{ name: 'my-skill', required: true }] }],
      },
    }
    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'skill')!
    expect(step.status).toBe('pass')
  })

  it('AC-B2-07: MCP Server auth missing → missing', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      dependencies: {
        ...BASE_PROFILE.dependencies,
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
      },
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
      dependencies: {
        ...BASE_PROFILE.dependencies,
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
      },
    }

    const result = checkDependencies(profile, tempDir, {
      appVersion: '1.0.0',
      accountValues: new Map([['COMPANY_API_TOKEN', 'tok_xxx']]),
    })

    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('pass')
  })

  it('required tool not in builtin → missing', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      dependencies: {
        ...BASE_PROFILE.dependencies,
        tools: [{ name: 'nonexistent_tool', required: true }],
      },
    }

    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'tool')!
    expect(step.status).toBe('missing')
    expect(step.details).toContain('nonexistent_tool')
  })

  it('builtin tool in whitelist → pass', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      dependencies: {
        ...BASE_PROFILE.dependencies,
        tools: [{ name: 'bash', required: true }],
      },
    }

    const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
    const step = result.steps.find((s) => s.step === 'tool')!
    expect(step.status).toBe('pass')
  })

  describe('TASK-3 subagent dependency check (AC-030, AC-031)', () => {
    it('AC-030 (trigger): missing required subagent', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        dependencies: {
          ...BASE_PROFILE.dependencies,
          subagents: [{ id: 'B', required: true }],
        },
      }
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(['A', 'C']), // B 不在内
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('missing')
      expect(step.message).toContain('B')
    })

    it('AC-031 (no-trigger): all required subagents are registered', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        dependencies: {
          ...BASE_PROFILE.dependencies,
          subagents: [
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

    it('non-required subagent missing → still pass', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        dependencies: {
          ...BASE_PROFILE.dependencies,
          subagents: [{ id: 'optional-helper', required: false }],
        },
      }
      const result = checkDependencies(profile, tempDir, {
        appVersion: '1.0.0',
        registeredBusinessAgents: new Set(),
      })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })

    it('skip subagent check when registeredBusinessAgents not provided (back-compat)', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        dependencies: {
          ...BASE_PROFILE.dependencies,
          subagents: [{ id: 'B', required: true }],
        },
      }
      const result = checkDependencies(profile, tempDir, { appVersion: '1.0.0' })
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })
  })
})
