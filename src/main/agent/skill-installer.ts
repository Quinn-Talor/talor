// src/main/agent/skill-installer.ts — 业务层:Schema 2.0 skill 自动安装
//
// v2.0: SkillItem 是 flat 形态 { name, required, purpose? }—— 没有 source 字段。
// skill 安装来源由 Talor 装配阶段从全局位置扫描:
//   1. ~/.claude/skills/<name>/SKILL.md
//   2. ~/.skills/<name>/SKILL.md
//   3. ~/.agents/skills/<name>/SKILL.md
//   命中即 cpSync(deref symlinks) 到 <agentDir>/skills/<name>/。
//   全部未命中 → log warn,失败不阻断保存,dep-checker 后续会标 missing,
//   UI 提示用户手动放到 ~/.claude/skills/<name>/。
//
// 用户痛点:profile.skills 声明依赖,但 SKILL.md 不在 <root>/skills/<name>/
// 时 SkillRegistry 加载空 → LLM 看到 capabilities 提到 skill 但工具列表里没 → 卡死。
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

const GLOBAL_SKILL_ROOTS = [
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.skills'),
  join(homedir(), '.agents', 'skills'),
]

/**
 * 为 agent 安装 profile.skills 中声明的 skill 包到 <agentDir>/skills/<name>/.
 * 幂等:若 SKILL.md 已存在则跳过。失败仅 log warn,不抛(让 IPC 完成保存)。
 *
 * v8.1 仅支持全局目录扫描 — SkillItem 是 flat,无 source 字段。
 */
export async function installAgentSkills(
  profile: AgentProfile,
  agentDir: string,
): Promise<InstallResult> {
  const result: InstallResult = { installed: [], skipped: [], failed: [] }
  const skills = profile.skills ?? []
  if (skills.length === 0) return result

  const skillsRoot = join(agentDir, 'skills')
  if (!existsSync(skillsRoot)) mkdirSync(skillsRoot, { recursive: true })

  for (const item of skills) {
    const targetDir = join(skillsRoot, item.name)

    // 已安装(SKILL.md 存在) → 幂等跳过
    if (existsSync(join(targetDir, 'SKILL.md'))) {
      result.skipped.push({ name: item.name, reason: 'already installed' })
      continue
    }

    const globalHit = findInGlobalSkillRoots(item.name)
    if (globalHit) {
      try {
        cpSync(globalHit, targetDir, { recursive: true, dereference: true })
        result.installed.push({ name: item.name, from: `global:${globalHit}` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('[skill-installer]', item.name, 'copy failed:', msg)
        result.failed.push({ name: item.name, error: msg })
      }
    } else {
      const hint = `skill "${item.name}" not found in any of: ${GLOBAL_SKILL_ROOTS.join(', ')}`
      log.warn('[skill-installer]', hint)
      result.failed.push({ name: item.name, error: hint })
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

function findInGlobalSkillRoots(skillName: string): string | null {
  for (const root of GLOBAL_SKILL_ROOTS) {
    const candidate = join(root, skillName)
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate
  }
  return null
}
