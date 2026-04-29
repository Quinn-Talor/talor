import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ValidationResult } from '../types'
import { DEFAULT_MAX_WRITE_SIZE_BYTES } from '../types'
import { resolveToolPath } from '../path-guard'

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

  validate(input: unknown): ValidationResult {
    const params = input as { path?: unknown; content?: unknown }
    if (typeof params.path !== 'string' || !params.path.trim())
      return { ok: false, error: 'Missing required parameter: "path" must be a non-empty string.' }
    if (typeof params.content !== 'string')
      return { ok: false, error: 'Missing required parameter: "content" must be a string (empty string is allowed).' }
    return { ok: true }
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxWriteSizeBytes = DEFAULT_MAX_WRITE_SIZE_BYTES } = context
    const params = input as { path: string; content: string }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    const guard = resolveToolPath(params.path, workspace)
    if (guard.status === 'sensitive') {
      return { output: 'Cannot access sensitive system path' }
    }
    if (guard.status === 'needs_consent') {
      const approved = await context.requestPermission?.({
        toolName: 'write',
        reason: 'path_outside_workspace',
        absPath: guard.absPath,
        inputSummary: `write: ${params.path}`,
      })
      if (!approved) return { output: 'Cannot access path outside workspace (user denied).' }
    }
    const resolvedPath = guard.absPath

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
