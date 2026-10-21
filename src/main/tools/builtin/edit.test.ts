import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './edit'

const TMP = join(__dirname, '__tmp_edit_test__')

function makeContext(workspace = TMP) {
  return { sessionId: 'test-session', workspace }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  registerBuiltinTools()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  toolRegistry.clear()
})

describe('edit tool', () => {
  it('edits file with string replacement', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'hello world')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'world', new: 'universe' },
      makeContext(),
    )
    expect(result.output).toContain('Edited')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('hello universe')
  })

  it('replaces all occurrences when replaceAll is true', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'foo bar foo baz')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'foo', new: 'qux', replaceAll: true },
      makeContext(),
    )
    expect(result.output).toContain('2 replacement')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('qux bar qux baz')
  })

  it('refuses multi-match edit without replaceAll (EDIT_AMBIGUOUS_MATCH)', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'foo bar foo baz')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'foo', new: 'qux' },
      makeContext(),
    )
    const env = result.output as { __talor_error?: boolean; code?: string; message?: string }
    expect(env.__talor_error).toBe(true)
    expect(env.code).toBe('EDIT_AMBIGUOUS_MATCH')
    expect(env.message).toContain('2 times')
    // 文件不应被修改
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('foo bar foo baz')
  })

  it('single-match edit still works without replaceAll', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'foo bar baz')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'foo', new: 'qux' },
      makeContext(),
    )
    expect(result.output).toContain('1 replacement')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('qux bar baz')
  })

  it('multi-match edit succeeds when replaceAll explicitly true', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'foo bar foo baz')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'foo', new: 'qux', replaceAll: true },
      makeContext(),
    )
    expect(result.output).toContain('2 replacement')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('qux bar qux baz')
  })

  it('returns error for string not found', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'hello world')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'nonexistent', new: 'replacement' },
      makeContext(),
    )
    expect(result.output).toContain('String not found')
  })

  it('returns error for non-existent file', async () => {
    const result = await toolRegistry.execute(
      'edit',
      { path: 'nonexistent.txt', old: 'old', new: 'new' },
      makeContext(),
    )
    expect(result.output).toContain('not found')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute(
      'edit',
      { path: '../outside.txt', old: 'old', new: 'new' },
      makeContext(),
    )
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'old', new: 'new' },
      { sessionId: 'x', workspace: '' },
    )
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error for sensitive path', async () => {
    const result = await toolRegistry.execute(
      'edit',
      { path: '/etc/passwd', old: 'old', new: 'new' },
      makeContext(),
    )
    expect(result.output).toBe('Cannot access sensitive system path')
  })

  it('blocks symlink pointing outside workspace', async () => {
    const { symlinkSync } = await import('fs')
    const linkPath = join(TMP, 'evil_link')
    try {
      symlinkSync('/tmp', linkPath)
    } catch {
      return
    }
    const result = await toolRegistry.execute(
      'edit',
      { path: 'evil_link/test.txt', old: 'a', new: 'b' },
      makeContext(),
    )
    expect(result.output).toContain('Cannot access')
  })

  it('returns error for file exceeding size limit', async () => {
    writeFileSync(join(TMP, 'big.txt'), 'x'.repeat(100))
    const result = await toolRegistry.execute(
      'edit',
      { path: 'big.txt', old: 'x', new: 'y' },
      { ...makeContext(), maxReadSizeBytes: 10 },
    )
    expect(result.output).toContain('too large')
  })

  it('string not found message has no trailing ... for short string', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'hello')
    const result = await toolRegistry.execute(
      'edit',
      { path: 'file.txt', old: 'hi', new: 'bye' },
      makeContext(),
    )
    expect(result.output).toBe('String not found in file: hi')
  })

  describe('文件系统错误返回 ToolErrorEnvelope', () => {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

    it.skipIf(isRoot)('文件不可读 → FS_ERROR 信封(含 EACCES)', async () => {
      const { chmodSync } = await import('fs')
      const file = join(TMP, 'locked.txt')
      writeFileSync(file, 'hello')
      chmodSync(file, 0o000)
      const result = await toolRegistry.execute(
        'edit',
        { path: 'locked.txt', old: 'hello', new: 'bye' },
        makeContext(),
      )
      chmodSync(file, 0o644)
      const env = result.output as { __talor_error?: boolean; code?: string; message?: string }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('FS_ERROR')
      expect(env.message).toContain('EACCES')
    })

    it('可读文件 → 正常编辑,不是信封', async () => {
      writeFileSync(join(TMP, 'ok.txt'), 'hello')
      const result = await toolRegistry.execute(
        'edit',
        { path: 'ok.txt', old: 'hello', new: 'bye' },
        makeContext(),
      )
      expect(typeof result.output).toBe('string')
    })
  })
})
