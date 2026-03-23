import { readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/']

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

function searchRecursive(dir: string, pattern: string, results: string[], depth: number, maxDepth: number = 10): void {
  if (depth > maxDepth) return
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relativePath = relative(dir, fullPath)
      if (entry.isDirectory()) {
        if (matchGlob(pattern, relativePath + '/')) {
          results.push(relativePath + '/')
        }
        searchRecursive(fullPath, pattern, results, depth + 1, maxDepth)
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
      searchRecursive(workspace, params.pattern, results, 0)
      return { output: results.length > 0 ? results : [] }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(globTool)
}