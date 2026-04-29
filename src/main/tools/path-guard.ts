import { join, isAbsolute, normalize, dirname, basename } from 'path'
import { realpathSync } from 'fs'
import { homedir } from 'os'

// 硬拒绝名单：任何工具都不得访问。即使用户想授权也不开放——这些路径泄漏
// 等同于系统/账号完全失控（SSH 密钥、云凭证、浏览器 Cookie、Keychain 等）。
//
// 路径以 '/' 结尾，startsWith 匹配；用户主目录用 ~ 展开。
const SENSITIVE_PATHS = [
  // 系统
  '/etc/', '/root/', '/usr/bin/', '/usr/sbin/',
  // SSH / 加密密钥
  '/.ssh/', '/.gnupg/',
  // 云凭证 / 包管理 token
  '/.aws/', '/.npm/', '/.docker/', '/.kube/', '/.netrc',
  // macOS 钥匙串 / 浏览器 Cookie / 应用敏感数据
  '/Library/Keychains/',
  '/Library/Application Support/Google/Chrome/',
  '/Library/Application Support/Firefox/Profiles/',
  '/Library/Cookies/',
  '/Library/Safari/',
]

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
