import { join, isAbsolute, normalize, dirname, basename } from 'path'
import { realpathSync } from 'fs'
import { homedir } from 'os'

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/', '/usr/bin/', '/usr/sbin/']

const SKILL_ROOTS = [
  join(homedir(), '.talor', 'skills'),
  join(homedir(), '.talor', 'agents'),
]

export function isPathSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some(sp => path.startsWith(sp))
}

/**
 * Resolves filePath to an absolute path and verifies it is accessible.
 *
 * Allowed:
 *   - Paths within workspace (symlink-safe two-stage check)
 *   - Paths within ~/.talor/skills or ~/.talor/agents (skill system exemption)
 *
 * Returns null if the path is sensitive or escapes all allowed roots.
 */
export function resolveToolPath(filePath: string, workspace: string): string | null {
  if (isPathSensitive(filePath)) return null

  const normalized = normalize(isAbsolute(filePath) ? filePath : join(workspace, filePath))

  if (isPathSensitive(normalized)) return null

  if (SKILL_ROOTS.some(root => normalized.startsWith(root + '/') || normalized === root)) {
    return normalized
  }

  return resolveInWorkspace(workspace, filePath)
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
    // new file — walk up to first existing parent and verify it's within workspace
    let parent = dirname(normalized)
    let suffix = basename(normalized)
    while (parent !== dirname(parent)) {
      try {
        const realParent = realpathSync(parent)
        if (!realParent.startsWith(realWorkspace)) return null
        return join(realParent, suffix)
      } catch {
        suffix = join(basename(parent), suffix)
        parent = dirname(parent)
      }
    }
    return null
  }
}
