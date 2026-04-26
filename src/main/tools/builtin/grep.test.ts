import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './grep'

const TMP = join(__dirname, '__tmp_grep_test__')

function makeContext(workspace = TMP) {
  return { sessionId: 'test-session', workspace }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  mkdirSync(join(TMP, 'src'), { recursive: true })
  writeFileSync(join(TMP, 'file1.txt'), 'hello world\nfoo bar\nbaz')
  writeFileSync(join(TMP, 'src', 'code.ts'), 'function hello() {\n  return "world"\n}')
  registerBuiltinTools()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  toolRegistry.clear()
})

describe('grep tool', () => {
  it('finds pattern in file', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'hello' }, makeContext())
    expect(result.output).toContain('hello')
    expect(result.output).toContain('file1.txt')
  })

  it('finds pattern with context', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'foo' }, makeContext())
    expect(result.output).toContain('>')
    expect(result.output).toContain('foo')
  })

  it('returns no matches when pattern not found', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'nonexistent' }, makeContext())
    expect(result.output).toBe('No matches found')
  })

  it('respects case sensitivity', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'HELLO', caseSensitive: true }, makeContext())
    expect(result.output).toBe('No matches found')
  })

  it('searches in specific path', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'function', path: 'src' }, makeContext())
    expect(result.output).toContain('code.ts')
  })

  it('returns error for invalid regex', async () => {
    const result = await toolRegistry.execute('grep', { pattern: '[invalid' }, makeContext())
    expect(result.output).toContain('Invalid regex')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'test', path: '../outside' }, makeContext())
    expect(result.output).toBe('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'test' }, { sessionId: 'x', workspace: '' })
    expect(result.output).toContain('Workspace not set')
  })

  it('filters by include pattern', async () => {
    const result = await toolRegistry.execute('grep', { pattern: 'hello', include: '*.txt' }, makeContext())
    expect(result.output).toContain('file1.txt')
    expect(result.output).not.toContain('code.ts')
  })

  it('rejects catastrophic backtracking regex (ReDoS)', async () => {
    const start = Date.now()
    const result = await toolRegistry.execute(
      'grep',
      { pattern: '(a+)+b', path: 'file1.txt' },
      makeContext()
    )
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2000)
    expect(result.output).toBeDefined()
  }, 5000)

  it('blocks symlink pointing outside workspace', async () => {
    const { symlinkSync } = await import('fs')
    const linkPath = join(TMP, 'evil_link')
    try {
      symlinkSync('/etc', linkPath)
    } catch {
      return
    }
    const result = await toolRegistry.execute('grep', { pattern: 'root', path: 'evil_link' }, makeContext())
    expect(result.output).toBe('Cannot access path outside workspace')
  })
})
