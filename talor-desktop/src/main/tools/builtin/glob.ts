import { readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/']
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', '.venv', 'venv'])
const MAX_RESULTS = 200

function isPathSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some(sp => path.startsWith(sp))
}

function matchGlob(pattern: string, filePath: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${regexPattern}$`).test(filePath)
}

function searchRecursive(
  workspace: string,
  dir: string,
  pattern: string,
  results: string[],
  depth: number,
  maxDepth: number = 10,
): void {
  if (depth > maxDepth || results.length >= MAX_RESULTS) return
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue

      const fullPath = join(dir, entry.name)
      const relativePath = relative(workspace, fullPath)

      if (entry.isDirectory()) {
        searchRecursive(workspace, fullPath, pattern, results, depth + 1, maxDepth)
      } else if (entry.isFile()) {
        if (matchGlob(pattern, relativePath)) {
          results.push(relativePath)
        }
      }
    }
  } catch {
    // skip inaccessible dirs
  }
}

const globTool = {
  name: 'glob',
  description: 'Search for files matching a glob pattern within workspace. Returns list of matching file paths.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g., "*.ts", "src/**/*.tsx")' },
    },
    required: ['pattern'],
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace } = context
    const params = input as { pattern: string }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    if (!params.pattern || params.pattern.trim() === '') {
      return { output: 'Pattern cannot be empty' }
    }

    if (isPathSensitive(workspace)) {
      return { output: 'Cannot search sensitive system directory' }
    }

    if (!existsSync(workspace)) {
      return { output: `Workspace does not exist: ${workspace}` }
    }

    try {
      const results: string[] = []
      searchRecursive(workspace, workspace, params.pattern, results, 0)
      if (results.length === 0) return { output: [] }
      const truncated = results.length >= MAX_RESULTS
      return {
        output: truncated
          ? [...results, `... (truncated, showing first ${MAX_RESULTS} matches)`]
          : results,
      }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(globTool)
}
