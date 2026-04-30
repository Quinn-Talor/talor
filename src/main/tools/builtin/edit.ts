import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { z } from 'zod'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ToolErrorEnvelope } from '../types'
import { DEFAULT_MAX_READ_SIZE_BYTES } from '../types'
import { resolveToolPath } from '../path-guard'

const EditInput = z.object({
  path: z.string()
    .describe('File path to edit (relative to workspace or absolute)')
    .refine(p => p.trim().length > 0, 'Missing required parameter: "path" must be a non-empty string.'),
  old: z.string()
    .describe('The exact string to find and replace')
    .min(1, 'Missing required parameter: "old" must be a non-empty string.'),
  new: z.string().describe('The string to replace old with'),
  replaceAll: z.boolean().describe('Replace all occurrences or just the first').default(false),
})
type EditInputT = z.infer<typeof EditInput>

const editTool = {
  name: 'edit',
  description: 'Edit a file by replacing a specific string. Use to make targeted changes to a file.',
  riskLevel: 'HIGH' as const,
  zodSchema: EditInput,
  parameters: z.toJSONSchema(EditInput) as Record<string, unknown>,

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxReadSizeBytes = DEFAULT_MAX_READ_SIZE_BYTES } = context
    const params = input as EditInputT

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    const guard = resolveToolPath(params.path, workspace)
    if (guard.status === 'sensitive') {
      return { output: 'Cannot access sensitive system path' }
    }
    if (guard.status === 'needs_consent') {
      const approved = await context.requestPermission?.({
        toolName: 'edit',
        reason: 'path_outside_workspace',
        absPath: guard.absPath,
        inputSummary: `edit: ${params.path}`,
      })
      if (!approved) return { output: 'Cannot access path outside workspace (user denied).' }
    }
    const resolvedPath = guard.absPath

    if (!existsSync(resolvedPath)) {
      return { output: `File not found: ${params.path}` }
    }

    try {
      const stats = statSync(resolvedPath)
      if (!stats.isFile()) {
        return { output: `Not a file: ${params.path}` }
      }

      if (stats.size > maxReadSizeBytes) {
        return { output: `File too large: ${stats.size} bytes (max: ${maxReadSizeBytes})` }
      }

      const content = readFileSync(resolvedPath, 'utf-8')

      if (!content.includes(params.old)) {
        const preview = params.old.length > 50
          ? `${params.old.substring(0, 50)}...`
          : params.old
        return { output: `String not found in file: ${preview}` }
      }

      const occurrences = content.split(params.old).length - 1

      // 多处匹配但未指定 replaceAll → 拒绝。默认静默替换第一处会在代码库里留下
      // "随便改了哪一处没法解释"的炸弹;要求模型扩展 old_str 的上下文,或显式 replaceAll。
      if (occurrences > 1 && params.replaceAll !== true) {
        const envelope: ToolErrorEnvelope = {
          __talor_error: true,
          code: 'EDIT_AMBIGUOUS_MATCH',
          message: `String appears ${occurrences} times in ${params.path}. Edit refuses to silently pick one.`,
          hint: 'Either expand "old" to include more unique surrounding context, or pass replaceAll: true to replace all occurrences.',
        }
        return { output: envelope }
      }

      let newContent: string
      let replacedCount: number

      if (params.replaceAll) {
        newContent = content.split(params.old).join(params.new)
        replacedCount = occurrences
      } else {
        const idx = content.indexOf(params.old)
        newContent = content.substring(0, idx) + params.new + content.substring(idx + params.old.length)
        replacedCount = 1
      }

      writeFileSync(resolvedPath, newContent, 'utf-8')

      const oldLines = content.split('\n').length
      const newLines = newContent.split('\n').length

      return {
        output: `Edited ${params.path} (${replacedCount} replacement${replacedCount > 1 ? 's' : ''}, ${oldLines}→${newLines} lines)`,
      }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(editTool)
}
