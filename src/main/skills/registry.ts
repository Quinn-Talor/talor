import { loadSkillsFromDir } from './loader'
import type { ParsedSkill } from './types'

export class SkillRegistry {
  private skills = new Map<string, ParsedSkill>()
  private activated = new Set<string>()

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

  markActivated(name: string): void {
    this.activated.add(name)
  }

  isActivated(name: string): boolean {
    return this.activated.has(name)
  }

  listActivated(): string[] {
    return Array.from(this.activated)
  }

  isEmpty(): boolean {
    return this.skills.size === 0
  }
}
