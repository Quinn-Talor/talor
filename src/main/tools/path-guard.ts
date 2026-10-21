import { join, isAbsolute, normalize, dirname, basename, resolve, sep } from 'path'
import { realpathSync, lstatSync, readlinkSync } from 'fs'
import { homedir } from 'os'

// 硬拒绝名单：任何工具都不得访问。即使用户想授权也不开放——这些路径泄漏
// 等同于系统/账号完全失控（SSH 密钥、云凭证、浏览器 Cookie、Keychain 等）。
//
// 三类条目，均按路径段边界匹配（isWithin），不做裸前缀匹配：
//   - SYSTEM_SENSITIVE_ROOTS：系统绝对路径（含 macOS 下 /etc 的真实路径 /private/etc）
//   - HOME_SENSITIVE_ENTRIES：相对用户主目录，运行时展开为 homedir() 前缀
//   - SENSITIVE_SEGMENTS：任意位置出现该目录段即命中（其他用户 / root 的密钥目录）
const SYSTEM_SENSITIVE_ROOTS = [
  '/etc',
  '/private/etc',
  '/root',
  '/var/root',
  '/private/var/root',
  '/usr/bin',
  '/usr/sbin',
  '/Library/Keychains',
]

const HOME_SENSITIVE_ENTRIES = [
  // SSH / 加密密钥
  '.ssh',
  '.gnupg',
  // 云凭证 / 包管理 token
  '.aws',
  '.npm',
  '.docker',
  '.kube',
  '.netrc',
  // macOS 钥匙串 / 浏览器 Cookie / 应用敏感数据
  'Library/Keychains',
  'Library/Application Support/Google/Chrome',
  'Library/Application Support/Firefox/Profiles',
  'Library/Cookies',
  'Library/Safari',
]

const SENSITIVE_SEGMENTS = ['.ssh', '.gnupg', '.aws']

const SKILL_ROOTS = [join(homedir(), '.talor', 'skills'), join(homedir(), '.talor', 'agents')]

// macOS 默认文件系统大小写不敏感：/ETC/passwd 与 /etc/passwd 指向同一文件
const CASE_INSENSITIVE_FS = process.platform === 'darwin'

/**
 * path-guard 的三态结果：
 *   - 'allowed':        路径在 workspace / skill 根内，工具可直接使用 absPath
 *   - 'sensitive':      路径命中敏感列表，硬拒（即使用户想授权也不开放）
 *   - 'needs_consent':  非敏感、非 workspace、非 skill 根；absPath 已解析到绝对路径，
 *                       由工具层上调至 PermissionPort 询问用户
 */
export type PathGuardResult =
  | { status: 'allowed'; absPath: string }
  | { status: 'sensitive' }
  | { status: 'needs_consent'; absPath: string }

/**
 * child 是否等于 root 或位于 root 之下（按路径段边界判断）。
 * `/a/proj-secrets/x` 不在 `/a/proj` 内。调用方负责传入已规范化 / realpath 后的路径。
 */
export function isWithin(child: string, root: string): boolean {
  const r = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root
  if (child === r) return true
  return child.startsWith(r === sep ? sep : r + sep)
}

function foldCase(p: string): string {
  return CASE_INSENSITIVE_FS ? p.toLowerCase() : p
}

// 主目录本身可能经 symlink 挂载，字面路径与 realpath 两种形态都要覆盖
function homeRoots(): string[] {
  const home = homedir()
  try {
    const realHome = realpathSync(home)
    return realHome === home ? [home] : [home, realHome]
  } catch {
    return [home]
  }
}

export function isPathSensitive(path: string): boolean {
  if (!isAbsolute(path)) return false
  const p = foldCase(normalize(path))
  const roots = [
    ...SYSTEM_SENSITIVE_ROOTS,
    ...homeRoots().flatMap((home) => HOME_SENSITIVE_ENTRIES.map((e) => join(home, e))),
  ]
  if (roots.some((r) => isWithin(p, foldCase(r)))) return true
  const segments = p.split(sep)
  return SENSITIVE_SEGMENTS.some((s) => segments.includes(foldCase(s)))
}

const MAX_SYMLINK_HOPS = 32

/**
 * 解析路径的真实位置：存在则 realpath；不存在（新文件）则取最近存在的父目录
 * realpath 再拼回剩余部分；途经悬空 symlink 时按链接目标继续解析。
 * 无法解析时返回 null。
 */
export function realpathOrNearest(absPath: string, hops = 0): string | null {
  try {
    return realpathSync(absPath)
  } catch {
    // 不存在或悬空 symlink
  }
  if (hops > MAX_SYMLINK_HOPS) return null
  try {
    if (lstatSync(absPath).isSymbolicLink()) {
      const target = resolve(dirname(absPath), readlinkSync(absPath))
      return realpathOrNearest(target, hops + 1)
    }
  } catch {
    // 路径不存在，转而解析父目录
  }
  const parent = dirname(absPath)
  if (parent === absPath) return null
  const realParent = realpathOrNearest(parent, hops)
  return realParent ? join(realParent, basename(absPath)) : null
}

/**
 * 规范化路径，返回三态结果。
 *
 * 规范化规则：
 *   - 字面路径或 realpath 命中敏感名单 → 'sensitive'（无论用户输入什么形式，含 symlink）
 *   - 命中 SKILL_ROOTS     → 'allowed'（skill 系统内部路径，免授权）
 *   - workspace 内（含 symlink 两阶段校验） → 'allowed'
 *   - 其余                 → 'needs_consent'（解析到绝对路径供上层询问用户）
 */
export function resolveToolPath(filePath: string, workspace: string): PathGuardResult {
  if (isPathSensitive(filePath)) return { status: 'sensitive' }

  const normalized = normalize(isAbsolute(filePath) ? filePath : join(workspace, filePath))
  if (isPathSensitive(normalized)) return { status: 'sensitive' }

  const real = realpathOrNearest(normalized)
  if (real && isPathSensitive(real)) return { status: 'sensitive' }

  if (SKILL_ROOTS.some((root) => isWithin(normalized, root))) {
    return { status: 'allowed', absPath: normalized }
  }

  const inWorkspace = resolveInWorkspace(workspace, normalized)
  if (inWorkspace) return { status: 'allowed', absPath: inWorkspace }

  // 非敏感 + 非 workspace + 非 skill 根 → 需要用户授权
  return { status: 'needs_consent', absPath: normalized }
}

function resolveInWorkspace(workspace: string, normalized: string): string | null {
  if (!workspace) return null
  if (!isWithin(normalized, normalize(workspace))) return null

  let realWorkspace: string
  try {
    realWorkspace = realpathSync(workspace)
  } catch {
    return null
  }

  const real = realpathOrNearest(normalized)
  if (!real || !isWithin(real, realWorkspace)) return null
  return real
}
