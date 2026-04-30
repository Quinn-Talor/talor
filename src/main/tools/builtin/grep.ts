import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ValidationResult } from '../types'
import { resolveToolPath, isPathSensitive } from '../path-guard'

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache'])
const MAX_RESULTS = 100
const CONTEXT_LINES = 2

const REDOS_PATTERNS = [
  /\(\?[^)]*\)\+/,
  /\([^)]*\+[^)]*\)\+/,
  /\([^)]*\+[^)]*\)\*/,
  /\([^)]*\*[^)]*\)\+/,
  /\([^)]*\*[^)]*\)\*/,
]

function isSuspectedReDoS(pattern: string): boolean {
  return REDOS_PATTERNS.some(re => re.test(pattern))
}

const grepTool = {
  name: 'grep',
  description:
    'Search for a pattern in files using regex. Returns matching lines with context. ' +
    'Never use to locate skill definitions — skills live in memory, use the `skill` tool.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory path to search in (default: workspace root)', default: '.' },
      include: { type: 'string', description: 'Glob pattern for files to include (e.g., "*.ts")' },
      caseSensitive: { type: 'boolean', description: 'Whether search is case-sensitive', default: false },
    },
    required: ['pattern'],
  },

  validate(input: unknown): ValidationResult {
    const params = input as { pattern?: unknown }
    if (typeof params.pattern !== 'string' || !params.pattern.trim())
      return { ok: false, error: 'Missing required parameter: "pattern" must be a non-empty string.' }
    try {
      new RegExp(params.pattern)
    } catch (e) {
      return { ok: false, error: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}` }
    }
    return { ok: true }
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace } = context
    const params = input as { pattern: string; path?: string; include?: string; caseSensitive?: boolean }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    if (isPathSensitive(workspace)) {
      return { output: 'Cannot search sensitive system directory' }
    }

    const targetPath = params.path || '.'
    const guard = resolveToolPath(targetPath, workspace)
    if (guard.status === 'sensitive') {
      return { output: 'Cannot access sensitive system path' }
    }
    if (guard.status === 'needs_consent') {
      const approved = await context.requestPermission?.({
        toolName: 'grep',
        reason: 'path_outside_workspace',
        absPath: guard.absPath,
        inputSummary: `${params.pattern} in ${targetPath}`,
      })
      if (!approved) return { output: 'Cannot access path outside workspace (user denied).' }
    }
    const resolvedPath = guard.absPath

    if (!existsSync(resolvedPath)) {
      return { output: `Path not found: ${targetPath}` }
    }

    try {
      if (isSuspectedReDoS(params.pattern)) {
        return { output: 'Pattern rejected: potential ReDoS risk (nested quantifiers detected)' }
      }

      let regex: RegExp
      try {
        const flags = params.caseSensitive ? 'g' : 'gi'
        regex = new RegExp(params.pattern, flags)
      } catch (e) {
        return { output: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}` }
      }

      const filesToSearch: string[] = []
      const stats = statSync(resolvedPath)

      if (stats.isFile()) {
        filesToSearch.push(resolvedPath)
      } else {
        const includePattern = params.include || '*.{js,ts,jsx,tsx,py,md,txt,json,yaml,yml,toml,html,css,sh}'
        const exts: string[] = []
        
        const addExt = (pattern: string) => {
          const starIdx = pattern.indexOf('*.')
          if (starIdx !== -1) {
            exts.push(pattern.substring(starIdx + 1))
          }
        }
        
        if (includePattern.includes('{') && includePattern.includes('}')) {
          const braceMatch = includePattern.match(/\{([^}]+)\}/)
          if (braceMatch) {
            braceMatch[1].split(',').forEach(e => addExt(e.trim()))
          }
        } else if (includePattern.includes('*')) {
          addExt(includePattern)
        }
        
        if (exts.length === 0) exts.push('*')

        const matchAllExts = exts.includes('*')

        let realWorkspace: string
        try {
          realWorkspace = realpathSync(workspace)
        } catch {
          realWorkspace = workspace
        }

        function collectFiles(dir: string, depth: number): void {
          if (depth > 5 || filesToSearch.length >= MAX_RESULTS) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (filesToSearch.length >= MAX_RESULTS) break

              if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) collectFiles(join(dir, entry.name), depth + 1)
                continue
              }

              if (!entry.isFile()) continue

              const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop() : ''
              if (!matchAllExts && !exts.includes(`*.${ext}`) && !exts.some(e => e === ext)) continue

              const candidatePath = join(dir, entry.name)
              try {
                const realCandidate = realpathSync(candidatePath)
                if (realCandidate.startsWith(realWorkspace)) filesToSearch.push(candidatePath)
              } catch {
                // skip unresolvable symlinks
              }
            }
          } catch {
            // skip inaccessible
          }
        }

        collectFiles(resolvedPath, 0)
      }

      const results: string[] = []

      for (const filePath of filesToSearch) {
        if (results.length >= MAX_RESULTS) break

        try {
          const content = readFileSync(filePath, 'utf-8')
          const lines = content.split('\n')

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_RESULTS) break

            regex.lastIndex = 0
            if (regex.test(lines[i])) {
              const start = Math.max(0, i - CONTEXT_LINES)
              const end = Math.min(lines.length, i + CONTEXT_LINES + 1)
              const context: string[] = []

              for (let j = start; j < end; j++) {
                const prefix = j === i ? '>' : ' '
                context.push(`${String(j + 1).padStart(4)}${prefix}| ${lines[j]}`)
              }

              const relPath = filePath.replace(workspace, '').replace(/^\//, '')
              results.push(`--- ${relPath}:${i + 1} ---`)
              results.push(context.join('\n'))
              results.push('')
            }
          }
        } catch {
          // skip binary/inaccessible
        }
      }

      if (results.length === 0) {
        return { output: 'No matches found' }
      }

      let output = results.join('\n')
      if (results.length >= MAX_RESULTS) {
        output += `\n(truncated, showing first ${MAX_RESULTS} matches)`
      }

      return { output }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(grepTool)
}
