import { readdirSync, existsSync, realpathSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ToolErrorEnvelope } from '../types'
import { isPathSensitive, isWithin } from '../path-guard'

const GlobInput = z.object({
  pattern: z
    .string()
    .describe('Glob pattern (e.g., "*.ts", "src/**/*.tsx")')
    .refine((p) => p.trim().length > 0, 'Pattern cannot be empty'),
})
type GlobInputT = z.infer<typeof GlobInput>

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', '.venv', 'venv'])
const MAX_RESULTS = 200

/**
 * 花括号展开：`*.{ts,tsx}` → [`*.ts`, `*.tsx`]，支持嵌套与多组。
 * 无逗号的 `{x}` 视为字面量。
 */
export function expandBraces(pattern: string): string[] {
  let depth = 0
  let start = -1
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        const body = pattern.slice(start + 1, i)
        const alternatives = splitTopLevelCommas(body)
        if (alternatives.length < 2) continue
        const head = pattern.slice(0, start)
        const tail = pattern.slice(i + 1)
        return alternatives.flatMap((alt) => expandBraces(head + alt + tail))
      }
    }
  }
  return [pattern]
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(last, i))
      last = i + 1
    }
  }
  parts.push(body.slice(last))
  return parts
}

// 单个（已展开花括号的）glob 转正则源码。
// `**` 后接 `/` 时匹配零或多层目录；单独 `**` 匹配任意字符；`*` / `?` 不跨 `/`。
function globSegmentToRegexSource(pattern: string): string {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
        continue
      }
      out += '[^/]*'
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    i++
  }
  return out
}

/** glob → 正则（整串匹配）。支持 `**`、`*`、`?`、`{a,b}`。 */
export function globToRegex(pattern: string): RegExp {
  const sources = expandBraces(pattern).map(globSegmentToRegexSource)
  return new RegExp(`^(?:${sources.join('|')})$`)
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
      if (!isWithin(realFull, realWorkspace)) continue

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
  zodSchema: GlobInput,
  parameters: z.toJSONSchema(GlobInput) as Record<string, unknown>,

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace } = context
    const params = input as GlobInputT

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    // pattern 非空已由 Zod refine 保证

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
  toolRegistry.register(globTool)
}
