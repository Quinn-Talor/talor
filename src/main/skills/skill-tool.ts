import { dirname, resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import log from 'electron-log'
import type { ToolDefinition } from '../tools/types'
import type { SkillRegistry } from './registry'
import { SkillActivationTracker } from './registry'

function resolveRelativePaths(content: string, skillMdPath: string): string {
  const skillDir = dirname(skillMdPath)
  return content.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, text: string, href: string) => {
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
        return `[${text}](${href})`
      }
      const absPath = resolve(skillDir, href)
      return `[${text}](${absPath})`
    },
  )
}

function loadDependentSkills(content: string, skillMdPath: string, registry: SkillRegistry, tracker: SkillActivationTracker): string {
  const skillDir = dirname(skillMdPath)
  const deps: string[] = []

  const skillMdRefs = content.match(/\[([^\]]*)\]\(([^)]*SKILL\.md)\)/g) || []
  for (const ref of skillMdRefs) {
    const hrefMatch = ref.match(/\]\(([^)]+)\)/)
    if (!hrefMatch) continue
    const href = hrefMatch[1]
    if (href.startsWith('http')) continue

    const absPath = resolve(skillDir, href)
    if (!existsSync(absPath)) continue

    const depName = absPath.match(/\/([^/]+)\/SKILL\.md$/)?.[1]
    if (!depName) continue

    if (tracker.isActivated(depName)) continue

    try {
      const depContent = readFileSync(absPath, 'utf-8')
      const bodyMatch = depContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/)
      const body = bodyMatch ? bodyMatch[1].trimStart() : depContent
      tracker.markActivated(depName)
      deps.push(`[SKILL:${depName} auto-loaded (dependency)]\n\n${resolveRelativePaths(body, absPath)}`)
      log.info(`[SkillTool] Auto-loaded dependency skill: ${depName}`)
    } catch (err) {
      log.warn(`[SkillTool] Failed to load dependency skill: ${absPath}`, err)
    }
  }

  return deps.length > 0 ? '\n\n---\n\n' + deps.join('\n\n---\n\n') : ''
}

export function createSkillTool(registry: SkillRegistry, tracker?: SkillActivationTracker): ToolDefinition {
  const sessionTracker = tracker ?? new SkillActivationTracker()

  return {
    name: 'skill',
    description: '激活一个技能，获取其完整指令内容。可用技能列表在 system prompt 中提供。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名称' },
      },
      required: ['name'],
    },
    riskLevel: 'LOW',
    execute: async (input) => {
      const inputObj = input as Record<string, unknown>
      const name = typeof inputObj.name === 'string' ? inputObj.name : ''
      if (!name) {
        return { output: 'Missing required parameter: name' }
      }
      const skill = registry.getByName(name)

      if (!skill) {
        const available = registry.listAll().map(s => s.metadata.name).join(', ')
        return { output: `技能 "${name}" 不存在。可用技能：${available || '无'}` }
      }

      sessionTracker.markActivated(name)
      const resolved = resolveRelativePaths(skill.content, skill.filePath)
      const depContent = loadDependentSkills(skill.content, skill.filePath, registry, sessionTracker)
      return { output: `[SKILL:${name} activated]\n\n${resolved}${depContent}` }
    },
  }
}
