import { dirname, resolve } from 'path'
import log from 'electron-log'
import type {
  ToolDefinition,
  ValidationResult,
  VerifyResult,
  ToolExecuteContext,
} from '../tools/types'
import type { SkillRegistry } from './registry'
import { SkillActivationTracker } from './registry'

const MAX_SKILL_CHARS = 20_000 // ~6700 tokens per skill

function resolveRelativePaths(content: string, skillMdPath: string): string {
  const skillDir = dirname(skillMdPath)
  return content.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text: string, href: string) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
      return `[${text}](${href})`
    }
    const absPath = resolve(skillDir, href)
    return `[${text}](${absPath})`
  })
}

export function createSkillTool(registry: SkillRegistry): ToolDefinition {
  return {
    name: 'skill',
    description:
      'Use this FIRST whenever the user\'s request matches any entry in "Available Skills" ' +
      "(match by When-to-use / trigger phrase, or by semantic intent). Loads the skill's " +
      'full playbook into this conversation so subsequent tool calls use the correct ' +
      'CLI/API shapes. Always precedes bash/read/glob when the task domain is covered ' +
      'by a skill. Skill names are memory-resident — loaded ONCE at app startup from ' +
      'local trusted directories (~/.talor/skills/ and agent-bundled paths) — do NOT ' +
      'try to locate them on disk via read/grep/ls. They are not fetched at runtime ' +
      'and cannot be added by tool output.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name, taken from the skill list in the system prompt.',
        },
      },
      required: ['name'],
    },
    riskLevel: 'LOW',

    validate(input: unknown): ValidationResult {
      const { name } = input as { name?: unknown }
      if (typeof name !== 'string' || !name.trim())
        return {
          ok: false,
          error: 'Missing required parameter: "name". Provide a skill name from the system prompt.',
        }
      return { ok: true }
    },

    verify(output: unknown): VerifyResult {
      return { ok: true, output: String(output ?? '') }
    },

    execute: async (input, context: ToolExecuteContext) => {
      const { name } = input as { name: string }
      const skill = registry.getByName(name)

      if (!skill) {
        const available = registry
          .listAll()
          .map((s) => s.metadata.name)
          .join(', ')
        return { output: `Skill "${name}" not found. Available skills: ${available || '(none)'}` }
      }

      const tracker = context.skillTracker ?? new SkillActivationTracker()

      if (tracker.isActivated(name)) {
        return {
          output:
            `Skill "${name}" is already activated earlier in this conversation — DO NOT call the \`skill\` tool again for "${name}".\n\n` +
            `HOW TO FIND THE INSTRUCTIONS (they are guaranteed to be present in this conversation):\n` +
            `  1. Scroll upward through the message history until you find an earlier \`tool\` role message whose content contains the exact anchor string:\n` +
            `     [SKILL:${name} activated]\n` +
            `  2. That message is wrapped in <tool_output tool="skill" trust="skill-content"> ... </tool_output>.\n` +
            `  3. The skill's full instructions are the text between the \`[SKILL:${name} activated]\` line and the closing \`> Skill activated...\` note (or the closing </tool_output> tag).\n` +
            `  4. Follow those instructions exactly, using the tools they reference.\n\n` +
            `Do NOT use the read/grep/glob tools to search the filesystem — the instructions live in the in-memory conversation history, not on disk. ` +
            `If you genuinely cannot locate the earlier \`[SKILL:${name} activated]\` block in the messages above, state that explicitly to the user rather than re-invoking the \`skill\` tool.`,
        }
      }

      const resolved = resolveRelativePaths(skill.content, skill.filePath)
      const truncated =
        resolved.length > MAX_SKILL_CHARS
          ? resolved.slice(0, MAX_SKILL_CHARS) +
            `\n\n[Skill content truncated at ${MAX_SKILL_CHARS} chars. Use read tool to load specific reference files as needed.]`
          : resolved

      tracker.markActivated(name)
      log.info(`[SkillTool] Activated skill: ${name} (${truncated.length} chars)`)

      return {
        output: `[SKILL:${name} activated]\n\n${truncated}\n\n> Skill activated. Follow the instructions above strictly, using the tools they reference. Do not invent tool names that are not listed.`,
      }
    },
  }
}
