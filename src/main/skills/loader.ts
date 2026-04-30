import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import log from 'electron-log'
import type { SkillMetadata, ParsedSkill } from './types'

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseSkillMd(filePath: string): ParsedSkill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const match = raw.match(FRONTMATTER_REGEX)

    if (!match) {
      log.warn('[SkillLoader] SKILL.md has no frontmatter, skipping:', filePath)
      return null
    }

    const [, frontmatterStr, content] = match

    let parsed: Record<string, unknown>
    try {
      parsed = parseYaml(frontmatterStr) as Record<string, unknown>
    } catch (yamlErr) {
      log.warn('[SkillLoader] Failed to parse YAML frontmatter:', filePath, yamlErr)
      return null
    }

    const name = parsed.name as string | undefined
    const description = parsed.description as string | undefined

    if (!name || !description) {
      log.warn('[SkillLoader] SKILL.md missing name or description:', filePath)
      return null
    }

    const meta = parsed.metadata as Record<string, unknown> | undefined

    // when_to_use 是 Anthropic 官方 skill spec 的顶层字段,不放在 metadata 下。
    // 与 name/description 平级,便于与 Claude Code skill 目录互通。
    const rawWhenToUse = parsed.when_to_use
    const when_to_use = typeof rawWhenToUse === 'string' && rawWhenToUse.trim().length > 0
      ? rawWhenToUse.trim()
      : undefined

    const metadata: SkillMetadata = {
      name,
      description,
      version: parsed.version as string | undefined,
      when_to_use,
      requires: meta?.requires as { bins?: string[] } | undefined,
      cliHelp: meta?.cliHelp as string | undefined,
    }

    return { metadata, content: content.trimStart(), filePath }
  } catch (err) {
    log.warn('[SkillLoader] Failed to read SKILL.md:', filePath, err)
    return null
  }
}

export function loadSkillsFromDir(skillsDir: string): ParsedSkill[] {
  if (!existsSync(skillsDir)) {
    return []
  }

  const entries = readdirSync(skillsDir)
  const skills: ParsedSkill[] = []

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry)
    if (!statSync(entryPath).isDirectory()) continue

    const skillMdPath = join(entryPath, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    const parsed = parseSkillMd(skillMdPath)
    if (parsed) {
      skills.push(parsed)
    }
  }

  return skills
}
