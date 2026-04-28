// src/main/skills/registry.ts — 业务层：Skill 注册中心
//
// 持有 Skill 列表（只读）。激活状态由外部 per-session 管理，
// 不存储在 SkillRegistry 实例上（ADR-5 线程安全）。

import { loadSkillsFromDir } from './loader'
import type { ParsedSkill } from './types'

export class SkillRegistry {
  private skills = new Map<string, ParsedSkill>()

  static fromDir(skillsDir: string | null): SkillRegistry {
    const registry = new SkillRegistry()
    if (!skillsDir) return registry

    const parsed = loadSkillsFromDir(skillsDir)
    for (const skill of parsed) {
      registry.skills.set(skill.metadata.name, skill)
    }
    return registry
  }

  getByName(name: string): ParsedSkill | null {
    return this.skills.get(name) ?? null
  }

  listAll(): ParsedSkill[] {
    return Array.from(this.skills.values())
  }

  listDescriptions(): Array<{ name: string; description: string }> {
    return this.listAll().map(s => ({
      name: s.metadata.name,
      description: s.metadata.description,
    }))
  }

  isEmpty(): boolean {
    return this.skills.size === 0
  }
}

export class SkillActivationTracker {
  private activated = new Set<string>()

  markActivated(name: string): void {
    this.activated.add(name)
  }

  isActivated(name: string): boolean {
    return this.activated.has(name)
  }

  listActivated(): string[] {
    return Array.from(this.activated)
  }
}
