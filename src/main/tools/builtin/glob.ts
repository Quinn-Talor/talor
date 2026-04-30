import { readdirSync, existsSync, realpathSync } from 'fs'
import { join, relative } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { isPathSensitive } from '../path-guard'

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', '.venv', 'venv'])
const MAX_RESULTS = 200

function globToRegex(pattern: string): RegExp {
  // Replace glob metacharacters before escaping regex specials
  // Order matters: ** before *
  const regexStr = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/{{GLOBSTAR}}/g, '.*')
  return new RegExp(`^${regexStr}$`)
}

function searchRecursive(
  workspace: string,
  realWorkspace: string,
  dir: string,
  pattern: RegExp,
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

      let realFull: string
      try {
        realFull = realpathSync(fullPath)
      } catch {
        continue
      }
      if (!realFull.startsWith(realWorkspace)) continue

      const relativePath = relative(workspace, fullPath)

      if (entry.isDirectory()) {
        searchRecursive(workspace, realWorkspace, fullPath, pattern, results, depth + 1, maxDepth)
      } else if (entry.isFile()) {
        if (pattern.test(relativePath)) {
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
  description:
    'Search for files matching a glob pattern within workspace. Returns list of matching file paths. ' +
    'Never use to locate skill definitions — skills live in memory, use the `skill` tool.',
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

    let realWorkspace: string
    try {
      realWorkspace = realpathSync(workspace)
    } catch {
      return { output: `Cannot resolve workspace path: ${workspace}` }
    }

    try {
      const regex = globToRegex(params.pattern)
      const results: string[] = []
      searchRecursive(workspace, realWorkspace, workspace, regex, results, 0)
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
