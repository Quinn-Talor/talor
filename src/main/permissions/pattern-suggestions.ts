// src/main/permissions/pattern-suggestions.ts — 业务层：授权档位建议生成
//
// 硬编码模板，不用 LLM。每档都能给出精确的"会匹配什么 / 不会匹配什么"预览，
// 用户点击前看得清授权边界。
//
// 详细设计见 permissions.ts 里的 PatternSuggestion 注释。
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*

import { dirname, sep } from 'path'
import { homedir } from 'os'
import type { PatternSuggestion } from '@shared/types/permissions'

// '/' 不必转义（JS 正则字面量之外的字符串构造场景里无特殊含义），避免
// '/tmp/foo' → '\/tmp\/foo' 这种多余转义污染规则可读性。
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── Bash binary 分类表 ──────────────────────────────────────────────
//
// 只罗列"用过且能想清楚语义"的 binary。未在表里的默认按 'danger' 处理——
// 只给 exact 档位。宁可打扰多一点，也不给未知 binary 过宽授权。
type BinaryClass = 'readonly' | 'subcommand_based' | 'danger'

const BINARY_CLASS: Record<string, BinaryClass> = {
  // readonly: 可给 same-binary 档（即 ^<bin>( .*)?$）
  ls: 'readonly', cat: 'readonly', head: 'readonly', tail: 'readonly',
  grep: 'readonly', find: 'readonly', ps: 'readonly', df: 'readonly',
  du: 'readonly', pwd: 'readonly', whoami: 'readonly', date: 'readonly',
  echo: 'readonly', which: 'readonly', file: 'readonly',
  wc: 'readonly', sort: 'readonly', uniq: 'readonly', tree: 'readonly',
  stat: 'readonly', hostname: 'readonly', uptime: 'readonly',

  // subcommand-based: 给 same-subcommand 档（如 ^git log( .*)?$）
  git: 'subcommand_based', npm: 'subcommand_based', yarn: 'subcommand_based',
  pnpm: 'subcommand_based', cargo: 'subcommand_based', go: 'subcommand_based',
  docker: 'subcommand_based', kubectl: 'subcommand_based', brew: 'subcommand_based',
  pip: 'subcommand_based', pipx: 'subcommand_based',
  python: 'subcommand_based', python3: 'subcommand_based', node: 'subcommand_based',
  gh: 'subcommand_based', hg: 'subcommand_based',

  // danger: 只给 exact 档
  rm: 'danger', mv: 'danger', cp: 'danger',
  chmod: 'danger', chown: 'danger',
  dd: 'danger', mkfs: 'danger',
  kill: 'danger', killall: 'danger', pkill: 'danger',
  sudo: 'danger', su: 'danger', doas: 'danger',
  curl: 'danger', wget: 'danger',                     // 网络
  touch: 'danger', mkdir: 'danger', rmdir: 'danger',  // 写入类
  ln: 'danger',
  eval: 'danger', exec: 'danger', bash: 'danger', sh: 'danger', zsh: 'danger',
}

function classifyBinary(binary: string): BinaryClass {
  return BINARY_CLASS[binary] ?? 'danger'
}

/**
 * 从 bash 命令的原文（trim 后）生成档位建议。
 *
 * 降级规则（命中任意一条 → 只给 exact）：
 *   - 含 `|` / `&&` / `||` / `;` / 后台 `&`（管道/组合命令）
 *   - 含 `>` / `<` / `>>`（重定向）
 *   - 含 `$(...)` / `` `...` `` / `eval`（命令替换）
 *   - 含 `^VAR=value` 前缀（inline env var）
 *   - 未知 binary（不在 BINARY_CLASS）
 */
export function suggestBashPatterns(command: string): PatternSuggestion[] {
  const trimmed = command.trim()
  const exactPattern = `^${escapeRegex(trimmed)}$`
  const exactSuggestion: PatternSuggestion = {
    id: 'exact',
    label: 'Only this exact command',
    pattern: exactPattern,
    preview: { matches: [trimmed], doesNotMatch: [] },
  }

  if (containsComplexSyntax(trimmed)) return [exactSuggestion]

  const tokens = tokenize(trimmed)
  if (tokens.length === 0) return [exactSuggestion]

  const binary = tokens[0]
  const cls = classifyBinary(binary)

  if (cls === 'danger') return [exactSuggestion]

  if (cls === 'readonly') {
    const sameBinaryPattern = `^${escapeRegex(binary)}( .*)?$`
    return [
      exactSuggestion,
      {
        id: 'same_binary',
        label: `Any \`${binary} ...\` command (read-only)`,
        pattern: sameBinaryPattern,
        preview: {
          matches: [binary, `${binary} --help`, `${binary} file.txt`].slice(0, 3),
          doesNotMatch: [`rm -rf /tmp`, `sudo ${binary}`, `${binary}x something`],
        },
      },
    ]
  }

  // subcommand_based
  const subcommand = tokens.find((t, i) => i > 0 && !t.startsWith('-'))
  if (!subcommand) return [exactSuggestion]

  const sameSubcommandPattern = `^${escapeRegex(binary)} ${escapeRegex(subcommand)}( .*)?$`
  return [
    exactSuggestion,
    {
      id: 'same_subcommand',
      label: `Any \`${binary} ${subcommand} ...\` command`,
      pattern: sameSubcommandPattern,
      preview: {
        matches: [
          `${binary} ${subcommand}`,
          `${binary} ${subcommand} --verbose`,
          `${binary} ${subcommand} arg`,
        ],
        doesNotMatch: [
          `${binary} other-sub`,
          `sudo ${binary} ${subcommand}`,
        ],
      },
    },
  ]
}

/** 简单 tokenize：不处理引号嵌套，够本表的分类判断用。 */
function tokenize(cmd: string): string[] {
  return cmd.split(/\s+/).filter(t => t.length > 0)
}

function containsComplexSyntax(cmd: string): boolean {
  // 管道 / 组合 / 后台
  if (/[|&;]/.test(cmd)) return true
  // 重定向
  if (/[<>]/.test(cmd)) return true
  // 命令替换
  if (/\$\(|`/.test(cmd)) return true
  // inline env var prefix: ^VAR=...
  if (/^[A-Z_][A-Z0-9_]*=/.test(cmd)) return true
  return false
}

// ── Path 档位建议 ───────────────────────────────────────────────────

type PathZone = 'home_subdir' | 'tmp' | 'system' | 'other_home' | 'other'

function classifyPath(absPath: string): PathZone {
  const home = homedir()
  if (absPath.startsWith('/tmp/') || absPath.startsWith('/private/tmp/')) return 'tmp'
  if (absPath.startsWith(home + '/Desktop/')) return 'home_subdir'
  if (absPath.startsWith(home + '/Documents/')) return 'home_subdir'
  if (absPath.startsWith(home + '/Downloads/')) return 'home_subdir'
  if (absPath.startsWith(home + '/Projects/')) return 'home_subdir'
  if (absPath.startsWith(home + sep)) return 'other_home'
  if (absPath.startsWith('/usr/') || absPath.startsWith('/opt/')) return 'system'
  return 'other'
}

/**
 * 为路径生成档位建议。不同 zone 给不同档位：
 *   - home_subdir (Desktop/Documents/Downloads/Projects): exact + parent + top
 *   - tmp:          exact + /tmp/**
 *   - other_home (~/xxx 其他):  exact + parent（不给顶级，避免整个 ~ 被放行）
 *   - system (/usr, /opt):      exact + parent
 *   - other (/Volumes 等):      exact only
 */
export function suggestPathPatterns(absPath: string): PatternSuggestion[] {
  const exactSuggestion: PatternSuggestion = {
    id: 'exact',
    label: 'Only this exact path',
    pattern: absPath,
    preview: { matches: [absPath], doesNotMatch: [] },
  }

  const zone = classifyPath(absPath)
  const parent = dirname(absPath) + sep
  const home = homedir()

  switch (zone) {
    case 'home_subdir': {
      // home_subdir 的顶级目录（~/Desktop、~/Downloads 等）
      const relFromHome = absPath.slice(home.length + 1)   // 去掉 "$HOME/"
      const topName = relFromHome.split(sep)[0]
      const topDir = `${home}${sep}${topName}${sep}`
      const out: PatternSuggestion[] = [
        exactSuggestion,
        {
          id: 'parent_dir',
          label: `Any file in ${parent}`,
          pattern: parent,
          preview: {
            matches: [absPath, `${parent}other-file.txt`],
            doesNotMatch: [`${home}/elsewhere/file.txt`],
          },
        },
      ]
      // 当 parent == topDir 时 parent 和 top_dir 档位重合，不加 top
      if (parent !== topDir) {
        out.push({
          id: 'top_dir',
          label: `Any file under ${topDir}`,
          pattern: topDir,
          preview: {
            matches: [absPath, `${topDir}foo.md`, `${topDir}sub/bar.md`],
            doesNotMatch: [`${home}/OtherDir/x.md`],
          },
        })
      }
      return out
    }
    case 'tmp': {
      return [
        exactSuggestion,
        {
          id: 'parent_dir',
          label: 'Any file in /tmp/',
          pattern: '/tmp/',
          preview: {
            matches: [absPath, '/tmp/other.log'],
            doesNotMatch: ['/Users/alice/Desktop/x', '/var/log/x'],
          },
        },
      ]
    }
    case 'system':
    case 'other_home': {
      return [
        exactSuggestion,
        {
          id: 'parent_dir',
          label: `Any file in ${parent}`,
          pattern: parent,
          preview: {
            matches: [absPath, `${parent}sibling.txt`],
            doesNotMatch: [dirname(parent) + sep + 'elsewhere/x.txt'],
          },
        },
      ]
    }
    case 'other':
    default:
      return [exactSuggestion]
  }
}
