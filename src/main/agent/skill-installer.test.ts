// src/main/agent/skill-installer.test.ts — 引用化:skill onboard 到平台 ~/.talor/skills/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { installAgentSkills } from './skill-installer'
import type { AgentProfile } from '@shared/types/agent'

let tempAgentDir: string

const MINIMAL_PROFILE: AgentProfile = {
  id: 't',
  name: 't',
  description: 't',
  agentPrompt: '## Workflow\n1. Do thing.',
}

beforeEach(() => {
  tempAgentDir = mkdtempSync(join(tmpdir(), 'agent-installer-test-'))
})

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true })
})

describe('installAgentSkills (引用化:onboard 到平台 ~/.talor/skills/)', () => {
  it('returns empty result when skills is empty / undefined', async () => {
    const r = await installAgentSkills(MINIMAL_PROFILE, tempAgentDir)
    expect(r.installed).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.failed).toEqual([])
  })

  it('skips skill already in platform', async () => {
    const platformLarkDoc = join(homedir(), '.talor', 'skills', 'lark-doc', 'SKILL.md')
    if (!existsSync(platformLarkDoc)) {
      console.warn('Skipping: ~/.talor/skills/lark-doc/SKILL.md not on this machine')
      return
    }
    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: ['lark-doc'],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0].name).toBe('lark-doc')
    expect(r.skipped[0].reason).toContain('already at platform')
    // 不会在 agent dir 创建 skills/(引用化语义)
    expect(existsSync(join(tempAgentDir, 'skills'))).toBe(false)
  })

  it('records failure when skill not found in platform nor fallback', async () => {
    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: ['totally-fake-skill-name-xyz123'],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.failed).toHaveLength(1)
    expect(r.installed).toHaveLength(0)
    expect(r.failed[0].name).toBe('totally-fake-skill-name-xyz123')
    expect(r.failed[0].error).toContain('not found in platform')
  })

  it('handles multiple skills in one call', async () => {
    const profile: AgentProfile = {
      ...MINIMAL_PROFILE,
      skills: ['unknown-skill-zzz-a', 'unknown-skill-zzz-b'],
    }
    const r = await installAgentSkills(profile, tempAgentDir)
    expect(r.failed.map((f) => f.name).sort()).toEqual([
      'unknown-skill-zzz-a',
      'unknown-skill-zzz-b',
    ])
    expect(r.installed).toHaveLength(0)
  })
})
