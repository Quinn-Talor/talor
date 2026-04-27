import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createSkillTool } from './skill-tool'
import { SkillRegistry } from './registry'

let tempDir: string

function createSkillDir(baseDir: string, name: string, description: string, content: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${name}
description: "${description}"
---

${content}
`)
}

beforeEach(() => {
  vi.clearAllMocks()
  tempDir = mkdtempSync(join(tmpdir(), 'skill-tool-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('createSkillTool', () => {
  it('AC-S2-01: activates skill and returns full content', async () => {
    createSkillDir(tempDir, 'lark-sheets', '飞书表格', '# sheets (v3)\n操作飞书电子表格的指令...')

    const registry = SkillRegistry.fromDir(tempDir)
    const tool = createSkillTool(registry)

    const result = await tool.execute({ name: 'lark-sheets' }, { sessionId: 'test', workspace: '' })

    expect(result.output).toMatch(/^\[SKILL:lark-sheets activated\]/)
    expect(result.output).toContain('# sheets (v3)')
    expect(result.output).toContain('操作飞书电子表格的指令...')
    expect(registry.isActivated('lark-sheets')).toBe(true)
  })

  it('AC-S2-02: returns error for nonexistent skill', async () => {
    const registry = SkillRegistry.fromDir(tempDir)
    const tool = createSkillTool(registry)

    const result = await tool.execute({ name: 'nonexist' }, { sessionId: 'test', workspace: '' })

    expect(result.output).toContain('技能 "nonexist" 不存在')
  })

  it('AC-S2-03: repeated activation returns full content', async () => {
    createSkillDir(tempDir, 'lark-sheets', '飞书表格', '# sheets (v3)\ncontent here')

    const registry = SkillRegistry.fromDir(tempDir)
    const tool = createSkillTool(registry)

    const first = await tool.execute({ name: 'lark-sheets' }, { sessionId: 'test', workspace: '' })
    const second = await tool.execute({ name: 'lark-sheets' }, { sessionId: 'test', workspace: '' })

    expect(second.output).toMatch(/^\[SKILL:lark-sheets activated\]/)
    expect(second.output).toContain('# sheets (v3)')
    expect(second.output).toBe(first.output)
  })

  it('has correct tool metadata', () => {
    const registry = SkillRegistry.fromDir(null)
    const tool = createSkillTool(registry)

    expect(tool.name).toBe('skill')
    expect(tool.riskLevel).toBe('LOW')
    expect(tool.parameters).toBeDefined()
  })

  it('error message includes available skills list', async () => {
    createSkillDir(tempDir, 'skill-a', 'A', 'content a')
    createSkillDir(tempDir, 'skill-b', 'B', 'content b')

    const registry = SkillRegistry.fromDir(tempDir)
    const tool = createSkillTool(registry)

    const result = await tool.execute({ name: 'nonexist' }, { sessionId: 'test', workspace: '' })

    expect(result.output).toContain('skill-a')
    expect(result.output).toContain('skill-b')
  })
})
