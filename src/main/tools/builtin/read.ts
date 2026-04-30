import { readFileSync, existsSync, statSync } from 'fs'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ValidationResult, VerifyResult } from '../types'
import { DEFAULT_MAX_READ_SIZE_BYTES } from '../types'
import { resolveToolPath } from '../path-guard'

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

const readTool = {
  name: 'read',
  description:
    'Read content of a file. Returns file content as string, or error message. ' +
    'Never use to locate skill definitions — skills live in memory, use the `skill` tool.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace or absolute path' },
    },
    required: ['path'],
  },

  validate(input: unknown): ValidationResult {
    const params = input as { path?: unknown }
    if (typeof params.path !== 'string' || !params.path.trim())
      return { ok: false, error: 'Missing required parameter: "path" must be a non-empty string.' }
    if (params.path.includes('\0'))
      return { ok: false, error: 'Invalid path: contains null byte.' }
    return { ok: true }
  },

  verify(output: unknown): VerifyResult {
    const raw = String(output ?? '')
    if (raw.startsWith('File not found:')) {
      return { ok: true, output: `${raw}\n[hint: use ls or glob to find the correct path]` }
    }
    return { ok: true, output }
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxReadSizeBytes = DEFAULT_MAX_READ_SIZE_BYTES } = context
    const params = input as { path: string }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    const guard = resolveToolPath(params.path, workspace)
    if (guard.status === 'sensitive') {
      return { output: 'Cannot access sensitive system path' }
    }
    if (guard.status === 'needs_consent') {
      const approved = await context.requestPermission?.({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: guard.absPath,
        inputSummary: params.path,
      })
      if (!approved) return { output: 'Cannot access path outside workspace (user denied).' }
    }
    const resolvedPath = guard.status === 'allowed' ? guard.absPath : guard.absPath

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