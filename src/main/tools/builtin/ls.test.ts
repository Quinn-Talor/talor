import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './ls'

const TMP = join(__dirname, '__tmp_ls_test__')
const OUTSIDE = join(__dirname, '__tmp_ls_test__-outside')

function makeContext(workspace = TMP) {
  return { sessionId: 'test-session', workspace }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  mkdirSync(join(TMP, 'subdir'), { recursive: true })
  writeFileSync(join(TMP, 'file1.txt'), 'content1')
  writeFileSync(join(TMP, 'subdir', 'file2.txt'), 'content2')
  registerBuiltinTools()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  rmSync(OUTSIDE, { recursive: true, force: true })
  toolRegistry.clear()
})

describe('ls tool', () => {
  it('lists workspace root contents', async () => {
    const result = await toolRegistry.execute('ls', {}, makeContext())
    expect(result.output).toContain('file1.txt')
    expect(result.output).toContain('subdir/')
  })

  it('lists subdirectory contents', async () => {
    const result = await toolRegistry.execute('ls', { path: 'subdir' }, makeContext())
    expect(result.output).toContain('file2.txt')
  })

  it('lists directory with depth', async () => {
    const result = await toolRegistry.execute('ls', { path: '.', depth: 2 }, makeContext())
    expect(result.output).toContain('file1.txt')
    expect(result.output).toContain('file2.txt')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute('ls', { path: '../outside' }, makeContext())
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute('ls', {}, { sessionId: 'x', workspace: '' })
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error for non-existent path', async () => {
    const result = await toolRegistry.execute('ls', { path: 'nonexistent' }, makeContext())
    expect(result.output).toContain('not found')
  })

  it('returns error for file path (not directory)', async () => {
    const result = await toolRegistry.execute('ls', { path: 'file1.txt' }, makeContext())
    expect(result.output).toContain('Not a directory')
  })

  it('shows hidden files when requested', async () => {
    writeFileSync(join(TMP, '.hidden'), 'hidden content')
    const result = await toolRegistry.execute('ls', { showHidden: true }, makeContext())
    expect(result.output).toContain('.hidden')
  })

  it('blocks symlink pointing outside workspace', async () => {
    const { symlinkSync } = await import('fs')
    const linkPath = join(TMP, 'evil_link')
    try {
      symlinkSync('/etc', linkPath)
    } catch {
      return
    }
    const result = await toolRegistry.execute('ls', { path: 'evil_link' }, makeContext())
    expect(result.output).toBe('Cannot access sensitive system path')
  })

  it('同前缀兄弟目录不视为 workspace 内(需授权)', async () => {
    mkdirSync(OUTSIDE, { recursive: true })
    const result = await toolRegistry.execute('ls', { path: OUTSIDE }, makeContext())
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  it('workspace 内 symlink 指向同前缀兄弟目录 → 列表中不展开', async () => {
    const { symlinkSync } = await import('fs')
    mkdirSync(OUTSIDE, { recursive: true })
    writeFileSync(join(OUTSIDE, 'secret.txt'), 's')
    symlinkSync(OUTSIDE, join(TMP, 'sib_link'))
    const result = await toolRegistry.execute('ls', { path: '.', depth: 2 }, makeContext())
    expect(result.output).not.toContain('sib_link')
    expect(result.output).not.toContain('secret.txt')
  })

  describe('已授权的 workspace 外目录', () => {
    const OTHER = `${OUTSIDE}-other`

    beforeEach(() => {
      mkdirSync(join(OUTSIDE, 'inner'), { recursive: true })
      writeFileSync(join(OUTSIDE, 'ext.md'), 'x')
      mkdirSync(OTHER, { recursive: true })
    })

    afterEach(() => {
      rmSync(OTHER, { recursive: true, force: true })
    })

    it('用户批准后列出外部目录内容', async () => {
      const result = await toolRegistry.execute(
        'ls',
        { path: OUTSIDE },
        { ...makeContext(), requestPermission: async () => true },
      )
      expect(result.output).toContain('ext.md')
      expect(result.output).toContain('inner/')
    })

    it('外部目录内 symlink 逃逸到其他目录 → 不列出;指向自身子目录 → 列出', async () => {
      const { symlinkSync } = await import('fs')
      symlinkSync(OTHER, join(OUTSIDE, 'escape_link'))
      symlinkSync(join(OUTSIDE, 'inner'), join(OUTSIDE, 'inner_link'))
      const result = await toolRegistry.execute(
        'ls',
        { path: OUTSIDE },
        { ...makeContext(), requestPermission: async () => true },
      )
      expect(result.output).not.toContain('escape_link')
      expect(result.output).toContain('inner_link')
    })
  })

  it('caps depth at 10 to prevent excessive recursion', async () => {
    const result = await toolRegistry.execute('ls', { path: '.', depth: 999999 }, makeContext())
    expect(result.output).toBeDefined()
  })
})
