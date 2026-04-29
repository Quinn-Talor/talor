import { dirname, resolve } from 'path'
import log from 'electron-log'
import type { ToolDefinition, ValidationResult, VerifyResult, ToolExecuteContext } from '../tools/types'
import type { SkillRegistry } from './registry'
import { SkillActivationTracker } from './registry'

const MAX_SKILL_CHARS = 20_000     // ~6700 tokens per skill

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

export function createSkillTool(registry: SkillRegistry): ToolDefinition {
  return {
    name: 'skill',
    description: '激活一个技能，获取其完整操作指令。技能名称（如 lark-doc、lark-wiki）不是工具名，不可直接调用，必须通过本工具激活后才能使用。可用技能列表在系统提示中提供。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名称，来自系统提示中的技能列表' },
      },
      required: ['name'],
    },
    riskLevel: 'LOW',

    validate(input: unknown): ValidationResult {
      const { name } = input as { name?: unknown }
      if (typeof name !== 'string' || !name.trim())
        return { ok: false, error: 'Missing required parameter: "name". Provide a skill name from the system prompt.' }
      return { ok: true }
    },

    verify(output: unknown): VerifyResult {
      return { ok: true, output: String(output ?? '') }
    },

    execute: async (input, context: ToolExecuteContext) => {
      const { name } = input as { name: string }
      const skill = registry.getByName(name)

      if (!skill) {
        const available = registry.listAll().map(s => s.metadata.name).join(', ')
        return { output: `技能 "${name}" 不存在。可用技能：${available || '无'}` }
      }

      const tracker = context.skillTracker ?? new SkillActivationTracker()

      if (tracker.isActivated(name)) {
        return { output: `技能 "${name}" 已激活，请直接按之前 tool_result 中的指令执行，无需重复激活。` }
      }

      const resolved = resolveRelativePaths(skill.content, skill.filePath)
      const truncated = resolved.length > MAX_SKILL_CHARS
        ? resolved.slice(0, MAX_SKILL_CHARS) + `\n\n[Skill content truncated at ${MAX_SKILL_CHARS} chars. Use read tool to load specific reference files as needed.]`
        : resolved

      tracker.markActivated(name)
      log.info(`[SkillTool] Activated skill: ${name} (${truncated.length} chars)`)

      return {
        output: `[SKILL:${name} activated]\n\n${truncated}\n\n> 技能已激活，请严格按照以上指令使用对应工具执行操作，不要调用不存在的工具名。`,
      }
    },
  }
}
