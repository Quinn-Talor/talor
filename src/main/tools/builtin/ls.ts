import { readdirSync, existsSync, statSync, realpathSync } from 'fs'
import { join, isAbsolute, normalize, dirname } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/']
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache'])

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
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (relative to workspace or absolute, default: workspace root)', default: '.' },
      depth: { type: 'number', description: 'Depth of recursive listing (1 = current dir only)', default: 1 },
      showHidden: { type: 'boolean', description: 'Whether to show hidden files (starting with .)', default: false },
    },
    required: [],
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace } = context
    const params = input as { path?: string; depth?: number; showHidden?: boolean }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    const targetPath = params.path || '.'
    const resolvedPath = resolveInWorkspace(workspace, targetPath)
    if (!resolvedPath) {
      return { output: 'Cannot access path outside workspace' }
    }

    if (isPathSensitive(resolvedPath)) {
      return { output: 'Cannot access sensitive system path' }
    }

    if (!existsSync(resolvedPath)) {
      return { output: `Path not found: ${targetPath}` }
    }

    try {
      const stats = statSync(resolvedPath)
      if (!stats.isDirectory()) {
        return { output: `Not a directory: ${targetPath}` }
      }

      const depth = Math.min(params.depth ?? 1, 10)
      const showHidden = params.showHidden || false
      const entries: string[] = []

      function collectEntries(dir: string, currentDepth: number): void {
        if (currentDepth > depth) return

        try {
          const items = readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            if (!showHidden && item.name.startsWith('.')) continue
            if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue

            const fullPath = join(dir, item.name)
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
