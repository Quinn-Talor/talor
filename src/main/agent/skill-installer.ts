// src/main/agent/skill-installer.ts — 业务层:Skill 平台位置 onboarding
//
// 引用化架构:profile.skills 是 string[] 引用 ~/.talor/skills/<name>/SKILL.md。
// agent 不再有私有 skill 副本。
//
// 安装流程:遍历 profile.skills,若 Talor 平台目录 ~/.talor/skills/<name>/SKILL.md
// 已存在 → 跳过;否则从备用位置 cpSync 到平台目录(含 Claude Code skill 库共享)。
//
//   1. ~/.talor/skills/<name>/SKILL.md   (Talor 平台真相, 优先)
//   2. ~/.claude/skills/<name>/SKILL.md  (Claude Code 共享,兼容既有库)
//   3. ~/.skills/<name>/SKILL.md         (备用源)
//   4. ~/.agents/skills/<name>/SKILL.md  (备用源)
//
// 允许依赖:agent/*、shared/*、Node std
// 禁止依赖:ipc/*

import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log'
import type { AgentProfile } from '@shared/types/agent'

export interface InstallResult {
  installed: Array<{ name: string; from: string }>
  skipped: Array<{ name: string; reason: string }>
  failed: Array<{ name: string; error: string }>
}

const PLATFORM_SKILLS_DIR = join(homedir(), '.talor', 'skills')
const FALLBACK_SKILL_ROOTS = [
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.skills'),
  join(homedir(), '.agents', 'skills'),
]

/**
 * 确保 profile.skills 中每个 skill 在平台目录 ~/.talor/skills/ 已 onboard。
 * 若已在平台 → 跳过;否则从 fallback 源(~/.claude/skills、~/.skills、~/.agents/skills)cpSync 过去。
 * 失败仅 log warn,不抛(让 IPC 完成保存),dep-checker 后续会标 missing。
 *
 * @param profile - agent profile (consumes profile.skills: string[])
 * @param _agentDir - unused (kept for signature compatibility);引用化后 agent 不存 skill
 */
export async function installAgentSkills(
  profile: AgentProfile,
  _agentDir: string,
): Promise<InstallResult> {
  const result: InstallResult = { installed: [], skipped: [], failed: [] }
  const skills = profile.skills ?? []
  if (skills.length === 0) return result

  if (!existsSync(PLATFORM_SKILLS_DIR)) {
    mkdirSync(PLATFORM_SKILLS_DIR, { recursive: true })
  }

  for (const skillName of skills) {
    const targetDir = join(PLATFORM_SKILLS_DIR, skillName)

    // 已在平台 → 跳过
    if (existsSync(join(targetDir, 'SKILL.md'))) {
      result.skipped.push({ name: skillName, reason: 'already at platform' })
      continue
    }

    const fallbackHit = findInFallbackRoots(skillName)
    if (fallbackHit) {
      try {
        cpSync(fallbackHit, targetDir, { recursive: true, dereference: true })
        result.installed.push({ name: skillName, from: `fallback:${fallbackHit}` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('[skill-installer]', skillName, 'copy failed:', msg)
        result.failed.push({ name: skillName, error: msg })
      }
    } else {
      const hint = `skill "${skillName}" not found in platform ${PLATFORM_SKILLS_DIR} nor fallback ${FALLBACK_SKILL_ROOTS.join(', ')}`
      log.warn('[skill-installer]', hint)
      result.failed.push({ name: skillName, error: hint })
    }
  }

  log.info(
    '[skill-installer] done — installed:',
    result.installed.length,
    'skipped:',
    result.skipped.length,
    'failed:',
    result.failed.length,
  )
  return result
}

function findInFallbackRoots(skillName: string): string | null {
  for (const root of FALLBACK_SKILL_ROOTS) {
    const candidate = join(root, skillName)
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate
  }
  return null
}
