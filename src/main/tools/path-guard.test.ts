import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 主目录指向临时目录，使家目录类敏感条目的判定与本机真实 ~ 无关
const h = vi.hoisted(() => ({
  fakeHome: `${process.env.TMPDIR ?? '/tmp/'}/talor-path-guard-home-${process.pid}`.replace(
    /\/+/g,
    '/',
  ),
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => h.fakeHome, default: { ...actual, homedir: () => h.fakeHome } }
})

import { isPathSensitive, isWithin, resolveToolPath } from './path-guard'

let base: string
let workspace: string

beforeAll(() => {
  mkdirSync(join(h.fakeHome, '.aws'), { recursive: true })
  writeFileSync(join(h.fakeHome, '.aws', 'credentials'), 'secret')
  mkdirSync(join(h.fakeHome, 'projects'), { recursive: true })
  base = mkdtempSync(join(tmpdir(), 'talor-path-guard-'))
  workspace = join(base, 'proj')
  mkdirSync(workspace)
  mkdirSync(join(base, 'proj-secrets'))
  writeFileSync(join(base, 'proj-secrets', 'x.txt'), 'x')
  writeFileSync(join(workspace, 'a.txt'), 'a')
})

afterAll(() => {
  rmSync(h.fakeHome, { recursive: true, force: true })
  rmSync(base, { recursive: true, force: true })
})

describe('isWithin', () => {
  it('同前缀的兄弟目录不算在内', () => {
    expect(isWithin('/a/proj-secrets/x', '/a/proj')).toBe(false)
  })

  it('自身与子路径算在内(root 带尾部分隔符也成立)', () => {
    expect(isWithin('/a/proj', '/a/proj')).toBe(true)
    expect(isWithin('/a/proj/x', '/a/proj')).toBe(true)
    expect(isWithin('/a/proj/x', '/a/proj/')).toBe(true)
    expect(isWithin('/a/proj', '/a/proj/')).toBe(true)
  })
})

describe('isPathSensitive', () => {
  it('家目录下的 .ssh / .aws / Library/Keychains 命中', () => {
    expect(isPathSensitive(join(h.fakeHome, '.ssh', 'id_rsa'))).toBe(true)
    expect(isPathSensitive(join(h.fakeHome, '.aws', 'credentials'))).toBe(true)
    expect(isPathSensitive(join(h.fakeHome, '.npm'))).toBe(true)
    expect(isPathSensitive(join(h.fakeHome, 'Library', 'Keychains', 'login.keychain-db'))).toBe(
      true,
    )
  })

  it('任意位置的 .ssh 目录段命中', () => {
    expect(isPathSensitive('/Users/other/.ssh/id_rsa')).toBe(true)
  })

  it('家目录普通路径、项目内 .npm 目录不命中', () => {
    expect(isPathSensitive(join(h.fakeHome, 'projects', 'x.ts'))).toBe(false)
    expect(isPathSensitive('/work/proj/.npm/cache')).toBe(false)
    expect(isPathSensitive('/work/proj/.sshrc')).toBe(false)
  })

  it('/etc 与其真实路径 /private/etc 命中', () => {
    expect(isPathSensitive('/etc/passwd')).toBe(true)
    expect(isPathSensitive('/etc')).toBe(true)
    expect(isPathSensitive('/private/etc/hosts')).toBe(true)
  })

  it('仅共享前缀的路径不命中', () => {
    expect(isPathSensitive('/etcetera/x')).toBe(false)
    expect(isPathSensitive('/usr/binaries/x')).toBe(false)
  })

  it.runIf(process.platform === 'darwin')('darwin 下大小写变体命中', () => {
    expect(isPathSensitive('/ETC/passwd')).toBe(true)
    expect(isPathSensitive(join(h.fakeHome, '.SSH', 'id_rsa'))).toBe(true)
  })
})

describe('resolveToolPath', () => {
  it('workspace 内 symlink 指向 ~/.aws → sensitive', () => {
    symlinkSync(join(h.fakeHome, '.aws'), join(workspace, 'aws_link'))
    expect(resolveToolPath('aws_link/credentials', workspace)).toEqual({ status: 'sensitive' })
  })

  it('workspace 内悬空 symlink 指向 ~/.npm(尚不存在) → sensitive', () => {
    symlinkSync(join(h.fakeHome, '.npm'), join(workspace, 'npm_link'))
    expect(resolveToolPath('npm_link/_authToken', workspace)).toEqual({ status: 'sensitive' })
  })

  it('/etc 经 workspace symlink 访问 → sensitive', () => {
    symlinkSync('/etc', join(workspace, 'etc_link'))
    expect(resolveToolPath('etc_link/hosts', workspace)).toEqual({ status: 'sensitive' })
  })

  it('workspace 同前缀兄弟目录 → needs_consent', () => {
    const r = resolveToolPath(join(base, 'proj-secrets', 'x.txt'), workspace)
    expect(r.status).toBe('needs_consent')
  })

  it('../ 跳到同前缀兄弟目录 → needs_consent', () => {
    const r = resolveToolPath('../proj-secrets/x.txt', workspace)
    expect(r.status).toBe('needs_consent')
  })

  it('workspace 内文件与新文件 → allowed', () => {
    expect(resolveToolPath('a.txt', workspace).status).toBe('allowed')
    expect(resolveToolPath('new/dir/b.txt', workspace).status).toBe('allowed')
  })

  it('skill 根内路径 → allowed', () => {
    const r = resolveToolPath(join(h.fakeHome, '.talor', 'skills', 'foo', 'SKILL.md'), workspace)
    expect(r.status).toBe('allowed')
  })

  it('同前缀的 skill 根兄弟目录 → needs_consent', () => {
    const r = resolveToolPath(join(h.fakeHome, '.talor', 'skills-evil', 'x'), workspace)
    expect(r.status).toBe('needs_consent')
  })
})
