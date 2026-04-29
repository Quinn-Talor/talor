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

/**
 * path-guard 的三态结果：
 *   - 'allowed':        路径在 workspace / skill 根内，工具可直接使用 absPath
 *   - 'sensitive':      路径命中敏感列表，硬拒（即使用户想授权也不开放）
 *   - 'needs_consent':  非敏感、非 workspace、非 skill 根；absPath 已解析到绝对路径，
 *                       由工具层上调至 PermissionPort 询问用户
 */
export type PathGuardResult =
  | { status: 'allowed';        absPath: string }
  | { status: 'sensitive' }
  | { status: 'needs_consent';  absPath: string }

export function isPathSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some(sp => path.startsWith(sp))
}

/**
 * 规范化路径，返回三态结果。
 *
 * 规范化规则：
 *   - 命中 SENSITIVE_PATHS → 'sensitive'（无论用户输入什么形式）
 *   - 命中 SKILL_ROOTS     → 'allowed'（skill 系统内部路径，免授权）
 *   - workspace 内（含 symlink 两阶段校验） → 'allowed'
 *   - 其余                 → 'needs_consent'（解析到绝对路径供上层询问用户）
 */
export function resolveToolPath(filePath: string, workspace: string): PathGuardResult {
  if (isPathSensitive(filePath)) return { status: 'sensitive' }

  const normalized = normalize(isAbsolute(filePath) ? filePath : join(workspace, filePath))
  if (isPathSensitive(normalized)) return { status: 'sensitive' }

  if (SKILL_ROOTS.some(root => normalized.startsWith(root + '/') || normalized === root)) {
    return { status: 'allowed', absPath: normalized }
  }

  const inWorkspace = resolveInWorkspace(workspace, filePath)
  if (inWorkspace) return { status: 'allowed', absPath: inWorkspace }

  // 非敏感 + 非 workspace + 非 skill 根 → 需要用户授权
  return { status: 'needs_consent', absPath: normalized }
}

function resolveInWorkspace(workspace: string, filePath: string): string | null {
  if (!workspace) return null
  const resolved = isAbsolute(filePath) ? filePath : join(workspace, filePath)
  const normalized = normalize(resolved)
  if (!normalized.startsWith(workspace)) return null

  let realWorkspace: string
  try {
    realWorkspace = realpathSync(workspace)
  } catch {
    return null
  }

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
