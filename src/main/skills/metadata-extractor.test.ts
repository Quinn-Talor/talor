import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { extractSkillCliBins } from './metadata-extractor'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'skill-meta-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeSkill(name: string, frontmatter: string): void {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${name}\ncontent`)
}

describe('extractSkillCliBins', () => {
  it('extracts bins from SKILL.md frontmatter', () => {
    writeSkill('lark-sheets', 'name: lark-sheets\nmetadata:\n  requires:\n    bins: ["lark-cli"]')

    const bins = extractSkillCliBins(tempDir)
    expect(bins).toEqual(['lark-cli'])
  })

  it('merges bins from multiple skills and deduplicates', () => {
    writeSkill(
      'lark-sheets',
      'name: lark-sheets\nmetadata:\n  requires:\n    bins: ["lark-cli", "node"]',
    )
    writeSkill('lark-im', 'name: lark-im\nmetadata:\n  requires:\n    bins: ["lark-cli"]')

    const bins = extractSkillCliBins(tempDir)
    expect(bins.sort()).toEqual(['lark-cli', 'node'])
  })

  it('returns empty for non-existent directory', () => {
    expect(extractSkillCliBins('/nonexistent')).toEqual([])
  })

  it('returns empty for skills without bins', () => {
    writeSkill('simple', 'name: simple\ndescription: "no bins"')
    expect(extractSkillCliBins(tempDir)).toEqual([])
  })

  it('returns empty for empty directory', () => {
    expect(extractSkillCliBins(tempDir)).toEqual([])
  })

  it('skips non-directory entries', () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'not a skill')
    writeSkill('lark-sheets', 'name: lark-sheets\nmetadata:\n  requires:\n    bins: ["lark-cli"]')

    const bins = extractSkillCliBins(tempDir)
    expect(bins).toEqual(['lark-cli'])
  })
})
