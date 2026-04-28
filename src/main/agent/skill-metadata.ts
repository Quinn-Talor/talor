// src/main/agent/skill-metadata.ts — 业务层：从 SKILL.md 提取 CLI 依赖
//
// 遍历 skills/*/SKILL.md，解析 frontmatter metadata.requires.bins。
//
// 允许依赖：fs
// 禁止依赖：ipc/*

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'

export function extractSkillCliBins(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return []

  const bins = new Set<string>()

  let entries: string[]
  try {
    entries = readdirSync(skillsDir)
  } catch {
    return []
  }

  for (const name of entries) {
    const skillDir = join(skillsDir, name)
    try {
      if (!statSync(skillDir).isDirectory()) continue
    } catch {
      continue
    }

    const skillMd = join(skillDir, 'SKILL.md')
    if (!existsSync(skillMd)) continue

    try {
      const content = readFileSync(skillMd, 'utf-8')
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fmMatch) continue

      const frontmatter = fmMatch[1]
      const binsMatch = frontmatter.match(/bins:\s*\[([^\]]*)\]/)
      if (!binsMatch) continue

      const binsList = binsMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)

      for (const bin of binsList) {
        bins.add(bin)
      }
    } catch (err) {
      log.warn('[skill-metadata] Failed to parse SKILL.md in', name, ':', err)
    }
  }

  return Array.from(bins)
}
