import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { parseSkillMd, loadSkillsFromDir } from './loader'
import log from 'electron-log'

let tempDir: string

beforeEach(() => {
  vi.clearAllMocks()
  tempDir = mkdtempSync(join(tmpdir(), 'skill-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('parseSkillMd', () => {
  it('AC-S3-01: parses normal SKILL.md with frontmatter', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: lark-sheets
version: 1.1.0
description: "飞书电子表格：创建和操作电子表格"
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli sheets --help"
---

# sheets (v3)
操作飞书电子表格的指令...
`,
    )

    const result = parseSkillMd(filePath)

    expect(result).not.toBeNull()
    expect(result!.metadata.name).toBe('lark-sheets')
    expect(result!.metadata.version).toBe('1.1.0')
    expect(result!.metadata.description).toBe('飞书电子表格：创建和操作电子表格')
    expect(result!.metadata.requires?.bins).toEqual(['lark-cli'])
    expect(result!.metadata.cliHelp).toBe('lark-cli sheets --help')
    expect(result!.content).toMatch(/^# sheets \(v3\)/)
    expect(result!.content).not.toContain('---')
    expect(result!.filePath).toBe(filePath)
  })

  it('AC-S3-02: returns null for SKILL.md without frontmatter', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(filePath, '这是一个没有 frontmatter 的 SKILL.md\n直接就是内容')

    const result = parseSkillMd(filePath)

    expect(result).toBeNull()
    expect(log.warn).toHaveBeenCalled()
  })

  it('AC-S3-03: returns null for invalid YAML frontmatter', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: [invalid yaml
  broken: {
---

内容部分
`,
    )

    const result = parseSkillMd(filePath)

    expect(result).toBeNull()
    expect(log.warn).toHaveBeenCalled()
  })

  it('returns null when name is missing', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
description: "有描述但没名字"
---

内容
`,
    )

    const result = parseSkillMd(filePath)
    expect(result).toBeNull()
    expect(log.warn).toHaveBeenCalled()
  })

  it('returns null when description is missing', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: test-skill
---

内容
`,
    )

    const result = parseSkillMd(filePath)
    expect(result).toBeNull()
    expect(log.warn).toHaveBeenCalled()
  })

  it('parses when_to_use when present (official Anthropic skill spec field)', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: lark-doc
description: "飞书云文档"
when_to_use: "用户要求写飞书文档时触发。触发短语：飞书文档,lark doc"
---

# doc
`,
    )
    const result = parseSkillMd(filePath)
    expect(result).not.toBeNull()
    expect(result!.metadata.when_to_use).toBe(
      '用户要求写飞书文档时触发。触发短语：飞书文档,lark doc',
    )
  })

  it('when_to_use is undefined when absent', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: simple
description: "no when_to_use"
---

content
`,
    )
    const result = parseSkillMd(filePath)
    expect(result!.metadata.when_to_use).toBeUndefined()
  })

  it('when_to_use empty string is treated as undefined', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: empty-when
description: "empty when_to_use"
when_to_use: "   "
---

content
`,
    )
    const result = parseSkillMd(filePath)
    expect(result!.metadata.when_to_use).toBeUndefined()
  })

  it('when_to_use non-string is treated as undefined', () => {
    const filePath = join(tempDir, 'SKILL.md')
    writeFileSync(
      filePath,
      `---
name: wrong-type
description: "when_to_use is array"
when_to_use:
  - "a"
  - "b"
---

content
`,
    )
    const result = parseSkillMd(filePath)
    expect(result!.metadata.when_to_use).toBeUndefined()
  })
})

describe('loadSkillsFromDir', () => {
  function writeSkill(name: string): void {
    const dir = join(tempDir, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "d"\n---\n\n# ${name}\n`)
  }

  it('悬空 symlink 条目被跳过并 warn,不影响其他 skill 加载', () => {
    writeSkill('good-skill')
    symlinkSync(join(tempDir, 'does-not-exist'), join(tempDir, 'broken-link'))

    const skills = loadSkillsFromDir(tempDir)

    expect(skills.map((s) => s.metadata.name)).toEqual(['good-skill'])
    expect(log.warn).toHaveBeenCalledWith(
      '[SkillLoader] Skipping unreadable skill entry:',
      join(tempDir, 'broken-link'),
      expect.anything(),
    )
  })

  it('全部条目正常时不产生跳过告警', () => {
    writeSkill('good-skill')
    loadSkillsFromDir(tempDir)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'skills 目录本身不可读 → 返回空数组并 warn,不抛出',
    () => {
      writeSkill('good-skill')
      chmodSync(tempDir, 0o000)
      try {
        expect(() => loadSkillsFromDir(tempDir)).not.toThrow()
        expect(loadSkillsFromDir(tempDir)).toEqual([])
        expect(log.warn).toHaveBeenCalled()
      } finally {
        chmodSync(tempDir, 0o755)
      }
    },
  )

  it('loads skills from subdirectories', () => {
    const skillADir = join(tempDir, 'lark-sheets')
    const skillBDir = join(tempDir, 'lark-im')
    mkdirSync(skillADir)
    mkdirSync(skillBDir)

    writeFileSync(
      join(skillADir, 'SKILL.md'),
      `---
name: lark-sheets
description: "飞书表格"
---

# sheets
`,
    )

    writeFileSync(
      join(skillBDir, 'SKILL.md'),
      `---
name: lark-im
description: "飞书消息"
---

# im
`,
    )

    const skills = loadSkillsFromDir(tempDir)

    expect(skills).toHaveLength(2)
    const names = skills.map((s) => s.metadata.name).sort()
    expect(names).toEqual(['lark-im', 'lark-sheets'])
  })

  it('skips directories without SKILL.md', () => {
    const skillDir = join(tempDir, 'valid')
    const emptyDir = join(tempDir, 'empty')
    mkdirSync(skillDir)
    mkdirSync(emptyDir)

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: valid
description: "valid skill"
---

content
`,
    )

    const skills = loadSkillsFromDir(tempDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].metadata.name).toBe('valid')
  })

  it('skips skills with invalid SKILL.md', () => {
    const validDir = join(tempDir, 'valid')
    const brokenDir = join(tempDir, 'broken')
    mkdirSync(validDir)
    mkdirSync(brokenDir)

    writeFileSync(
      join(validDir, 'SKILL.md'),
      `---
name: valid
description: "valid"
---

content
`,
    )

    writeFileSync(
      join(brokenDir, 'SKILL.md'),
      `---
name: [broken yaml
---

content
`,
    )

    const skills = loadSkillsFromDir(tempDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].metadata.name).toBe('valid')
  })

  it('returns empty array for nonexistent directory', () => {
    const skills = loadSkillsFromDir(join(tempDir, 'nonexistent'))
    expect(skills).toEqual([])
  })
})
