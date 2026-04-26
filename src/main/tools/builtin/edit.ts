import { readFileSync, writeFileSync, existsSync, statSync, realpathSync } from 'fs'
import { join, isAbsolute, normalize, dirname } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { DEFAULT_MAX_READ_SIZE_BYTES } from '../types'

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/', '/usr/bin/', '/usr/sbin/']

function isPathSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some(sp => path.startsWith(sp))
}

function resolveInWorkspace(workspace: string, filePath: string): string | null {
  const resolved = isAbsolute(filePath) ? filePath : join(workspace, filePath)
  const normalized = normalize(resolved)
  if (!normalized.startsWith(workspace)) return null

  const realWorkspace = realpathSync(workspace)

  try {
    const real = realpathSync(normalized)
    if (!real.startsWith(realWorkspace)) return null
    return real
  } catch {
    // path doesn't exist yet — check parent to guard against symlink traversal
    let parent = normalized
    while (parent !== dirname(parent)) {
      try {
        const realParent = realpathSync(parent)
        if (!realParent.startsWith(realWorkspace)) return null
        break
      } catch {
        parent = dirname(parent)
      }
    }
    return normalized
  }
}

const editTool = {
  name: 'edit',
  description: 'Edit a file by replacing a specific string. Use to make targeted changes to a file.',
  riskLevel: 'HIGH' as const,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit (relative to workspace or absolute)' },
      old: { type: 'string', description: 'The exact string to find and replace' },
      new: { type: 'string', description: 'The string to replace old with' },
      replaceAll: { type: 'boolean', description: 'Replace all occurrences or just the first', default: false },
    },
    required: ['path', 'old', 'new'],
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxReadSizeBytes = DEFAULT_MAX_READ_SIZE_BYTES } = context
    const params = input as { path: string; old: string; new: string; replaceAll?: boolean }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    if (isPathSensitive(params.path)) {
      return { output: 'Cannot access sensitive system path' }
    }

    const resolvedPath = resolveInWorkspace(workspace, params.path)
    if (!resolvedPath) {
      return { output: 'Cannot access path outside workspace' }
    }

    if (isPathSensitive(resolvedPath)) {
      return { output: 'Cannot access sensitive system path' }
    }

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
