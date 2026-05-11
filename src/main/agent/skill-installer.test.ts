// src/main/agent/skill-installer.test.ts — Schema 2.0 SkillItem 安装策略验证
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { installAgentSkills } from './skill-installer'
import type { AgentProfile } from '@shared/types/agent'

let tempAgentDir: string

const MINIMAL_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: 't',
  name: 't',
  description: 't',
  version: '1.0.0',
  agentPrompt: '## Workflow\n1. Do thing.',
}

beforeEach(() => {
  tempAgentDir = mkdtempSync(join(tmpdir(), 'agent-installer-test-'))
})

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true })
})

describe('installAgentSkills (schema 2.0 flat SkillItem)', () => {
  it('returns empty result when skills is empty / undefined', async () => {
    const r = await installAgentSkills(MINIMAL_PROFILE, tempAgentDir)
    expect(r.installed).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.failed).toEqual([])
  })

  it('copies skill from ~/.claude/skills if SKILL.md exists there', async () => {
    const globalLarkDoc = join(homedir(), '.claude', 'skills', 'lark-doc', 'SKILL.md')
    if (!existsSync(globalLarkDoc)) {
      console.warn('Skipping: ~/.claude/skills/lark-doc/SKILL.md not on this machine')
      return
    }
    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: [{ name: 'lark-doc', required: true }],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.installed).toHaveLength(1)
    expect(r.installed[0].name).toBe('lark-doc')
    expect(r.installed[0].from).toMatch(/^global:/)
    expect(existsSync(join(tempAgentDir, 'skills', 'lark-doc', 'SKILL.md'))).toBe(true)
  })

  it('skips already-installed skill (idempotent)', async () => {
    const skillDir = join(tempAgentDir, 'skills', 'fake-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: fake-skill\n---\n')

    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: [{ name: 'fake-skill', required: true }],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.installed).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0].name).toBe('fake-skill')
    expect(r.skipped[0].reason).toBe('already installed')
  })

  it('records failure when skill not found anywhere (not throws)', async () => {
    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: [{ name: 'totally-fake-skill-name-xyz123', required: true }],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.failed).toHaveLength(1)
    expect(r.installed).toHaveLength(0)
    expect(r.failed[0].name).toBe('totally-fake-skill-name-xyz123')
    expect(r.failed[0].error).toContain('not found in any of')
  })

  it('handles multiple skills in one call', async () => {
    // 预先放一个,另一个找不到 → skipped=1, failed=1
    const ok = join(tempAgentDir, 'skills', 'pre-installed')
    mkdirSync(ok, { recursive: true })
    writeFileSync(join(ok, 'SKILL.md'), '---\nname: pre-installed\n---\n')

    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: [
        { name: 'pre-installed', required: true },
        { name: 'unknown-skill-zzz', required: false },
      ],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.skipped.map((s) => s.name)).toContain('pre-installed')
    expect(r.failed.map((f) => f.name)).toContain('unknown-skill-zzz')
  })
})
