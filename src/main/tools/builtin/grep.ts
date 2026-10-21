import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ToolErrorEnvelope } from '../types'
import { resolveToolPath, isPathSensitive, isWithin } from '../path-guard'
import { globToRegex } from './glob'

const GrepInput = z.object({
  pattern: z
    .string()
    .describe('Regex pattern to search for')
    .refine(
      (p) => p.trim().length > 0,
      'Missing required parameter: "pattern" must be a non-empty string.',
    )
    .refine(
      (p) => {
        try {
          new RegExp(p)
          return true
        } catch {
          return false
        }
      },
      {
        error: (issue) => {
          // v4 error map: 尽量给出原始 regex 错误消息
          try {
            new RegExp(String(issue.input))
          } catch (e) {
            return `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`
          }
          return 'Invalid regex pattern'
        },
      },
    ),
  path: z
    .string()
    .describe('File or directory path to search in (default: workspace root)')
    .default('.'),
  include: z.string().describe('Glob pattern for files to include (e.g., "*.ts")').optional(),
  caseSensitive: z.boolean().describe('Whether search is case-sensitive').default(false),
})
type GrepInputT = z.infer<typeof GrepInput>

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache'])
// 匹配条数上限（输出体积）与候选文件数上限（遍历开销）分开计；两者截断都在输出中注明
const MAX_MATCHES = 100
const MAX_FILES = 5000
const DEFAULT_INCLUDE = '*.{js,ts,jsx,tsx,py,md,txt,json,yaml,yml,toml,html,css,sh}'
const CONTEXT_LINES = 2

const REDOS_PATTERNS = [
  /\(\?[^)]*\)\+/,
  /\([^)]*\+[^)]*\)\+/,
  /\([^)]*\+[^)]*\)\*/,
  /\([^)]*\*[^)]*\)\+/,
  /\([^)]*\*[^)]*\)\*/,
]

function isSuspectedReDoS(pattern: string): boolean {
  return REDOS_PATTERNS.some((re) => re.test(pattern))
}

const grepTool = {
  name: 'grep',
  description:
    'Search for a pattern in files using regex. Returns matching lines with context. ' +
    'Never use to locate skill definitions — skills live in memory, use the `skill` tool.',
  zodSchema: GrepInput,
  parameters: z.toJSONSchema(GrepInput) as Record<string, unknown>,

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace } = context
    const params = input as GrepInputT

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    if (isPathSensitive(workspace)) {
      return { output: 'Cannot search sensitive system directory' }
    }

    const targetPath = params.path
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
      let filesTruncated = false
      const stats = statSync(resolvedPath)

      if (stats.isFile()) {
        filesToSearch.push(resolvedPath)
      } else {
        // include 不含 `/` 时按文件名匹配，含 `/` 时按相对搜索根的路径匹配
        const includePattern = params.include || DEFAULT_INCLUDE
        const includeRegex = globToRegex(includePattern)
        const includeByPath = includePattern.includes('/')

        // 遍历只收录真实位置仍在「被访问根」或 workspace 内的文件，防 symlink 逃逸
        const allowedRoots = [realpathSync(resolvedPath)]
        try {
          allowedRoots.push(realpathSync(workspace))
        } catch {
          // workspace 不可解析时只认被访问根
        }

        const collectFiles = (dir: string, depth: number): void => {
          if (depth > 5 || filesTruncated) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (filesTruncated) return

              if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) collectFiles(join(dir, entry.name), depth + 1)
                continue
              }

              if (!entry.isFile()) continue

              const candidatePath = join(dir, entry.name)
              const subject = includeByPath ? relative(resolvedPath, candidatePath) : entry.name
              if (!includeRegex.test(subject)) continue

              try {
                const realCandidate = realpathSync(candidatePath)
                if (isPathSensitive(realCandidate)) continue
                if (!allowedRoots.some((root) => isWithin(realCandidate, root))) continue
                if (filesToSearch.length >= MAX_FILES) {
                  filesTruncated = true
                  return
                }
                filesToSearch.push(candidatePath)
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
      let matchCount = 0

      for (const filePath of filesToSearch) {
        if (matchCount >= MAX_MATCHES) break

        try {
          const content = readFileSync(filePath, 'utf-8')
          const lines = content.split('\n')

          for (let i = 0; i < lines.length; i++) {
            if (matchCount >= MAX_MATCHES) break

            regex.lastIndex = 0
            if (regex.test(lines[i])) {
              matchCount++
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

      const filesNote = filesTruncated
        ? `(file limit reached: only the first ${MAX_FILES} candidate files were searched; ` +
          'narrow "path" or "include" to search the rest)'
        : ''

      if (results.length === 0) {
        return { output: filesNote ? `No matches found\n${filesNote}` : 'No matches found' }
      }

      let output = results.join('\n')
      if (matchCount >= MAX_MATCHES) {
        output += `\n(truncated, showing first ${MAX_MATCHES} matches)`
      }
      if (filesNote) output += `\n${filesNote}`

      return { output }
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
  toolRegistry.register(grepTool)
}
