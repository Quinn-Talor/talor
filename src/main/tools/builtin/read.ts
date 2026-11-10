import { readFileSync, existsSync, statSync } from 'fs'
import { z } from 'zod'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ToolErrorEnvelope, VerifyResult } from '../types'
import { DEFAULT_MAX_READ_SIZE_BYTES, isToolErrorEnvelope, type ToolImageOutput } from '../types'
import { resolveToolPath } from '../path-guard'

const ReadInput = z.object({
  path: z
    .string()
    .describe('File path relative to workspace or absolute path')
    .refine(
      (p) => p.trim().length > 0,
      'Missing required parameter: "path" must be a non-empty string.',
    )
    .refine((p) => !p.includes('\0'), 'Invalid path: contains null byte.'),
})
type ReadInputT = z.infer<typeof ReadInput>

function isBinaryFile(content: Buffer): boolean {
  const signatures = [
    [0x89, 0x50, 0x4e, 0x47],
    [0xff, 0xd8, 0xff],
    [0x25, 0x50, 0x44, 0x46],
    [0xca, 0xfe, 0xba, 0xbe],
    [0x7f, 0x45, 0x4c, 0x46],
  ]
  return signatures.some((sig) => content.slice(0, 4).equals(Buffer.from(sig)))
}

/** 引擎对单张图片的上限（5MiB）；超过的不送给模型。 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function imageMediaType(content: Buffer): string | undefined {
  if (content.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png'
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (content.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (
    content.subarray(0, 4).toString('latin1') === 'RIFF' &&
    content.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return undefined
}

const readTool = {
  name: 'read',
  description:
    'Read content of a file. Returns file content as string, or error message. ' +
    'Image files (png/jpeg/gif/webp, up to 5MiB) are returned as images the model can see. ' +
    'Never use to locate skill definitions — skills live in memory, use the `skill` tool.',
  zodSchema: ReadInput,
  parameters: z.toJSONSchema(ReadInput) as Record<string, unknown>,

  verify(output: unknown): VerifyResult {
    if (isToolErrorEnvelope(output)) return { ok: true, output }
    const raw = String(output ?? '')
    if (raw.startsWith('File not found:')) {
      return { ok: true, output: `${raw}\n[hint: use ls or glob to find the correct path]` }
    }
    return { ok: true, output }
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, maxReadSizeBytes = DEFAULT_MAX_READ_SIZE_BYTES } = context
    const params = input as ReadInputT

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
    const resolvedPath = guard.absPath

    if (!existsSync(resolvedPath)) {
      return { output: `File not found: ${params.path}` }
    }

    try {
      const stats = statSync(resolvedPath)
      if (stats.size > maxReadSizeBytes) {
        return { output: `File too large: ${stats.size} bytes (max: ${maxReadSizeBytes})` }
      }

      const content = readFileSync(resolvedPath)
      const mediaType = imageMediaType(content)
      if (mediaType) {
        if (content.byteLength > MAX_IMAGE_BYTES) {
          return {
            output: `Image too large: ${content.byteLength} bytes (max: ${MAX_IMAGE_BYTES}). Downscale it first.`,
          }
        }
        const image: ToolImageOutput = {
          __talor_image: true,
          mediaType,
          base64: content.toString('base64'),
          label: `${params.path} (${mediaType}, ${content.byteLength} bytes)`,
        }
        return { output: image }
      }
      if (isBinaryFile(content)) {
        return { output: 'Cannot read binary file' }
      }

      return { output: content.toString('utf-8') }
    } catch (err) {
      const envelope: ToolErrorEnvelope = {
        __talor_error: true,
        code: 'FS_ERROR',
        message: err instanceof Error ? err.message : String(err),
      }
      return { output: envelope }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(readTool)
}
