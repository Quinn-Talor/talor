import { readdirSync, existsSync, statSync, realpathSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { resolveToolPath } from '../path-guard'

const LsInput = z.object({
  path: z.string()
    .describe('Directory path to list (relative to workspace or absolute, default: workspace root)')
    .default('.'),
  depth: z.number().int().min(1).max(10)
    .describe('Depth of recursive listing (1 = current dir only)')
    .default(1),
  showHidden: z.boolean()
    .describe('Whether to show hidden files (starting with .)')
    .default(false),
})
type LsInputT = z.infer<typeof LsInput>

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache'])

function formatSize(size: number): string {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`
}

function formatMode(mode: number): string {
  const isDir = (mode & 0o40000) !== 0
  let perms = isDir ? 'd' : '-'
  perms += (mode & 0o400) ? 'r' : '-'
  perms += (mode & 0o200) ? 'w' : '-'
  perms += (mode & 0o100) ? 'x' : '-'
  perms += (mode & 0o040) ? 'r' : '-'
  perms += (mode & 0o020) ? 'w' : '-'
  perms += (mode & 0o010) ? 'x' : '-'
  perms += (mode & 0o004) ? 'r' : '-'
  perms += (mode & 0o002) ? 'w' : '-'
  perms += (mode & 0o001) ? 'x' : '-'
  return perms
}

const lsTool = {
  name: 'ls',
  description: 'List directory contents. Shows files and subdirectories with permissions, size, and modification time.',
  zodSchema: LsInput,
  parameters: z.toJSONSchema(LsInput) as Record<string, unknown>,

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace } = context
    const params = input as LsInputT

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    const targetPath = params.path
    const guard = resolveToolPath(targetPath, workspace)
    if (guard.status === 'sensitive') {
      return { output: 'Cannot access sensitive system path' }
    }
    if (guard.status === 'needs_consent') {
      const approved = await context.requestPermission?.({
        toolName: 'ls',
        reason: 'path_outside_workspace',
        absPath: guard.absPath,
        inputSummary: targetPath,
      })
      if (!approved) return { output: 'Cannot access path outside workspace (user denied).' }
    }
    const resolvedPath = guard.absPath

    if (!existsSync(resolvedPath)) {
      return { output: `Path not found: ${targetPath}` }
    }

    try {
      const stats = statSync(resolvedPath)
      if (!stats.isDirectory()) {
        return { output: `Not a directory: ${targetPath}` }
      }

      // depth/showHidden 已由 Zod 校验+赋默认值,execute 只消费不二次处理
      const depth = params.depth
      const showHidden = params.showHidden
      const entries: string[] = []

      let realWorkspace: string
      try {
        realWorkspace = realpathSync(workspace)
      } catch {
        realWorkspace = workspace
      }

      function collectEntries(dir: string, currentDepth: number): void {
        if (currentDepth > depth) return

        try {
          const items = readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            if (!showHidden && item.name.startsWith('.')) continue
            if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue

            const fullPath = join(dir, item.name)

            let realFull: string
            try {
              realFull = realpathSync(fullPath)
            } catch {
              continue
            }
            if (!realFull.startsWith(realWorkspace)) continue

            try {
              const stat = statSync(fullPath)
              const mode = formatMode(stat.mode)
              const size = item.isFile() ? formatSize(stat.size) : '-'
              const mtime = new Date(stat.mtime).toISOString().split('T')[0]
              const name = item.isDirectory() ? `${item.name}/` : item.name
              entries.push(`${mode} ${size} ${mtime} ${name}`)

              if (item.isDirectory() && currentDepth < depth) {
                collectEntries(fullPath, currentDepth + 1)
              }
            } catch {
              // skip inaccessible
            }
          }
        } catch {
          // skip inaccessible
        }
      }

      collectEntries(resolvedPath, 1)

      if (entries.length === 0) {
        return { output: '(empty directory)' }
      }

      return { output: entries.join('\n') }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(lsTool)
}
