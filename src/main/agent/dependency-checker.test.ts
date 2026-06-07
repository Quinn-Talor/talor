// src/main/agent/dependency-checker.test.ts — Schema 2.0 引用化 tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// mock mcpServerRepo — dep-checker 用它做 MCP name lookup
vi.mock('../repos/mcp-server-repo', () => ({
  mcpServerRepo: {
    getByName: vi.fn((name: string) => {
      if (name === 'company-api') {
        return {
          id: '1',
          name: 'company-api',
          type: 'http',
          url: 'https://mcp.company.com',
          auth: { type: 'bearer', token: 'COMPANY_API_TOKEN' },
          enabled: true,
          created_at: '',
          updated_at: '',
        }
      }
      return null
    }),
  },
}))

// mock skill extractor — 引用化后从平台路径读
vi.mock('../skills/metadata-extractor', () => ({
  extractSkillCliBins: vi.fn(() => [] as string[]),
}))

import { checkDependencies } from './dependency-checker'
import type { AgentProfile } from '@shared/types/agent'

let tempDir: string

const BASE_PROFILE: AgentProfile = {
  id: 'test_agent',
  name: 'Test',
  description: 'Test agent.',
  agentPrompt: '## Workflow\n1. Do the thing.',
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dep-check-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('checkDependencies (schema 2.0 引用化)', () => {
  it('all pass for minimal profile', () => {
    const result = checkDependencies(BASE_PROFILE, tempDir)
    expect(result.passed).toBe(true)
    expect(result.steps.every((s) => s.status === 'pass')).toBe(true)
  })

  // references step 已删(字段从 schema 移除)
  it('missing skill in platform → missing status', () => {
    // 不创建 ~/.claude/skills/missing-skill/ 让它必然 missing
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      skills: ['missing-skill-that-does-not-exist-in-platform'],
    }
    const result = checkDependencies(profile, tempDir)
    const step = result.steps.find((s) => s.step === 'skill')!
    expect(step.status).toBe('missing')
    expect(step.details).toContain('missing-skill-that-does-not-exist-in-platform')
  })

  it('MCP Server not configured in DB → missing', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      mcpServers: ['nonexistent-mcp'],
    }
    const result = checkDependencies(profile, tempDir, { accountValues: new Map() })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('未在 Settings → MCP Servers 配置')
  })

  it('MCP Server auth missing → missing', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      mcpServers: ['company-api'],
    }
    const result = checkDependencies(profile, tempDir, { accountValues: new Map() })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('missing')
    expect(step.message).toContain('COMPANY_API_TOKEN')
  })

  it('MCP Server auth configured → pass', () => {
    const profile: AgentProfile = {
      ...BASE_PROFILE,
      mcpServers: ['company-api'],
    }
    const result = checkDependencies(profile, tempDir, {
      accountValues: new Map([['COMPANY_API_TOKEN', 'tok_xxx']]),
    })
    const step = result.steps.find((s) => s.step === 'mcpServer')!
    expect(step.status).toBe('pass')
  })

  // tool step 已删:validator rule 5 静态校验 tools 是 BuiltinToolName[],
  // 运行时无失败可能。dep-checker 不再重复校验。

  describe('subagent dependency check', () => {
    it('missing required subagent', () => {
      const profile: AgentProfile = {
        ...BASE_PROFILE,
        subagents: { ids: [{ id: 'B', required: true }] },
      }
      const result = checkDependencies(profile, tempDir, {
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
      const result = checkDependencies(profile, tempDir)
      const step = result.steps.find((s) => s.step === 'subagent')!
      expect(step.status).toBe('pass')
    })
  })
})
