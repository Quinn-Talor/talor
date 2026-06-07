import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { SkillRegistry, SkillActivationTracker } from './registry'

let tempDir: string

function createSkillDir(baseDir: string, name: string, description: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${name}
description: "${description}"
---

# ${name}
content for ${name}
`,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  tempDir = mkdtempSync(join(tmpdir(), 'registry-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('SkillRegistry', () => {
  it('AC-S4-01: agent-level isolation', () => {
    const dirA = join(tempDir, 'agentA')
    const dirB = join(tempDir, 'agentB')
    mkdirSync(dirA)
    mkdirSync(dirB)

    createSkillDir(dirA, 'lark-sheets', '飞书表格')
    createSkillDir(dirB, 'lark-im', '飞书消息')

    const registryA = SkillRegistry.fromDir(dirA)
    const registryB = SkillRegistry.fromDir(dirB)

    expect(registryA.getByName('lark-sheets')).not.toBeNull()
    expect(registryA.getByName('lark-im')).toBeNull()
    expect(registryB.getByName('lark-im')).not.toBeNull()
    expect(registryB.getByName('lark-sheets')).toBeNull()
  })

  it('AC-S4-02: null skillsDir returns empty registry', () => {
    const registry = SkillRegistry.fromDir(null)
    expect(registry.listAll()).toEqual([])
    expect(registry.isEmpty()).toBe(true)
  })

  it('listDescriptions returns name + description pairs', () => {
    createSkillDir(tempDir, 'skill-a', 'Description A')
    createSkillDir(tempDir, 'skill-b', 'Description B')

    const registry = SkillRegistry.fromDir(tempDir)
    const descriptions = registry.listDescriptions()

    expect(descriptions).toHaveLength(2)
    const names = descriptions.map((d) => d.name).sort()
    expect(names).toEqual(['skill-a', 'skill-b'])
  })

  it('SkillRegistry has no activation state (ADR-5: per-session)', () => {
    const registry = SkillRegistry.fromDir(null)
    expect((registry as unknown as Record<string, unknown>).markActivated).toBeUndefined()
    expect((registry as unknown as Record<string, unknown>).isActivated).toBeUndefined()
  })
})

describe('SkillActivationTracker', () => {
  it('tracks activation per-instance (per-session)', () => {
    const trackerA = new SkillActivationTracker()
    const trackerB = new SkillActivationTracker()

    trackerA.markActivated('lark-sheets')

    expect(trackerA.isActivated('lark-sheets')).toBe(true)
    expect(trackerB.isActivated('lark-sheets')).toBe(false)
  })

  it('listActivated returns activated names', () => {
    const tracker = new SkillActivationTracker()
    tracker.markActivated('skill-a')
    tracker.markActivated('skill-b')
    expect(tracker.listActivated().sort()).toEqual(['skill-a', 'skill-b'])
  })

  it('isActivated returns false for unknown', () => {
    const tracker = new SkillActivationTracker()
    expect(tracker.isActivated('nonexistent')).toBe(false)
  })
})
