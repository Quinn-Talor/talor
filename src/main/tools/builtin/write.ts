import { writeFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { join, isAbsolute, normalize } from 'path'
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
  if (!normalized.startsWith(workspace)) {
    return null
  }
  return normalized
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
      // Check content size
      const contentBytes = Buffer.byteLength(params.content, 'utf-8')
      if (contentBytes > maxWriteSizeBytes) {
        return { output: `Content too large: ${contentBytes} bytes (max: ${maxWriteSizeBytes})` }
      }

      // Create parent directories if needed
      const parentDir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'))
      if (parentDir && !existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true })
      }

      // Check if file exists
      const existed = existsSync(resolvedPath)
      const oldSize = existed ? statSync(resolvedPath).size : 0

      // Write content
      writeFileSync(resolvedPath, params.content, 'utf-8')

      const newSize = contentBytes
      const lines = params.content.split('\n').length

      const action = existed ? 'Updated' : 'Created'
      return {
        output: `${action} ${params.path} (${lines} lines, ${newSize} bytes)`,
      }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(writeTool)
}
