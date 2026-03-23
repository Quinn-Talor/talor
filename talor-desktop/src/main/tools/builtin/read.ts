import { readFileSync, existsSync, statSync } from 'fs'
import { join, isAbsolute, normalize } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { DEFAULT_MAX_READ_SIZE_BYTES } from '../types'

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/', '/usr/bin/', '/usr/sbin/']

function isPathSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some(sp => path.startsWith(sp))
}

function isBinaryFile(content: Buffer): boolean {
  const signatures = [
    [0x89, 0x50, 0x4e, 0x47],
    [0xff, 0xd8, 0xff],
    [0x25, 0x50, 0x44, 0x46],
    [0xca, 0xfe, 0xba, 0xbe],
    [0x7f, 0x45, 0x4c, 0x46],
  ]
  return signatures.some(sig => content.slice(0, 4).equals(Buffer.from(sig)))
}

function resolveInWorkspace(workspace: string, filePath: string): string | null {
  const resolved = isAbsolute(filePath) ? filePath : join(workspace, filePath)
  const normalized = normalize(resolved)
  if (!normalized.startsWith(workspace)) {
    return null
  }
  return normalized
}

const readTool = {
  name: 'read',
  description: 'Read content of a file. Returns file content as string, or error message.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace or absolute path' },
    },
    required: ['path'],
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxReadSizeBytes = DEFAULT_MAX_READ_SIZE_BYTES } = context
    const params = input as { path: string }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
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
      if (stats.size > maxReadSizeBytes) {
        return { output: `File too large: ${stats.size} bytes (max: ${maxReadSizeBytes})` }
      }

      const content = readFileSync(resolvedPath)
      if (isBinaryFile(content)) {
        return { output: 'Cannot read binary file' }
      }

      return { output: content.toString('utf-8') }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(readTool)
}