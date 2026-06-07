// src/main/skills/registry.ts — 业务层：Skill 注册中心
//
// 平台 SkillRegistry: 从 ~/.claude/skills/ 一次性加载所有 skill。
// 业务 Agent 通过 filterByNames(allowedNames) 拿到受限视图。
// 激活状态由外部 per-session 管理(ADR-5 线程安全)。

import { loadSkillsFromDir } from './loader'
import type { ParsedSkill } from './types'

export class SkillRegistry {
  private skills = new Map<string, ParsedSkill>()

  /**
   * 从指定目录加载 skill 索引。
   * 平台启动时调用一次,以 ~/.claude/skills/ 作为单一真相;business agent 不再有
   * 私有 skill 目录,通过 filterByNames 拿受限视图。
   */
  static fromPlatformDir(platformSkillsDir: string | null): SkillRegistry {
    const registry = new SkillRegistry()
    if (!platformSkillsDir) return registry

    const parsed = loadSkillsFromDir(platformSkillsDir)
    for (const skill of parsed) {
      registry.skills.set(skill.metadata.name, skill)
    }
    return registry
  }

  /**
   * 旧 API 别名,保持 backward source compat(主要给少数仍用 fromDir 的调用方)。
   * 语义等同 fromPlatformDir。
   * @deprecated 直接用 fromPlatformDir。
   */
  static fromDir(skillsDir: string | null): SkillRegistry {
    return SkillRegistry.fromPlatformDir(skillsDir)
  }

  /**
   * 按 skill name 白名单过滤,返回只含 allowedNames 列表中 skill 的副本。
   * 未在平台目录里找到的 name 静默跳过(由 dep-checker 报缺失)。
   */
  filterByNames(allowedNames: string[]): SkillRegistry {
    const filtered = new SkillRegistry()
    for (const name of allowedNames) {
      const skill = this.skills.get(name)
      if (skill) filtered.skills.set(name, skill)
    }
    return filtered
  }

  getByName(name: string): ParsedSkill | null {
    return this.skills.get(name) ?? null
  }

  listAll(): ParsedSkill[] {
    return Array.from(this.skills.values())
  }

  /** 仅返回 skill name 列表(供 UI 下拉选用)。 */
  listNames(): string[] {
    return Array.from(this.skills.keys())
  }

  listDescriptions(): Array<{ name: string; description: string }> {
    return this.listAll().map((s) => ({
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

  /** Clear all activation records. Called when memory compression invalidates skill tool_results. */
  clear(): void {
    this.activated.clear()
  }
}
