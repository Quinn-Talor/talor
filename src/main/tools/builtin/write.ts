import { writeFileSync, existsSync, mkdirSync, realpathSync } from 'fs'
import { join, isAbsolute, normalize, dirname, basename } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { DEFAULT_MAX_WRITE_SIZE_BYTES } from '../types'

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
    // new file — walk up to first existing parent and verify it's within workspace
    let parent = dirname(normalized)
    let suffix = basename(normalized)
    while (parent !== dirname(parent)) {
      try {
        const realParent = realpathSync(parent)
        if (!realParent.startsWith(realWorkspace)) return null
        return join(realParent, suffix)
      } catch {
        suffix = join(basename(parent), suffix)
        parent = dirname(parent)
      }
    }
    return null
  }
}

const writeTool = {
  name: 'write',
  description: 'Write content to a file. Creates a new file or overwrites existing file.',
  riskLevel: 'HIGH' as const,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace or absolute path' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxWriteSizeBytes = DEFAULT_MAX_WRITE_SIZE_BYTES } = context
    const params = input as { path: string; content: string }

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

    try {
      const contentBytes = Buffer.byteLength(params.content, 'utf-8')
      if (contentBytes > maxWriteSizeBytes) {
        return { output: `Content too large: ${contentBytes} bytes (max: ${maxWriteSizeBytes})` }
      }

      const parentDir = dirname(resolvedPath)
      mkdirSync(parentDir, { recursive: true })

      const existed = existsSync(resolvedPath)

      writeFileSync(resolvedPath, params.content, 'utf-8')

      const lines = params.content.split('\n').length
      const action = existed ? 'Updated' : 'Created'
      return {
        output: `${action} ${params.path} (${lines} lines, ${contentBytes} bytes)`,
      }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(writeTool)
}
