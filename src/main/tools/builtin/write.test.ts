import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './write'

const TMP = join(__dirname, '__tmp_write_test__')

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

describe('write tool', () => {
  it('creates new file with content', async () => {
    const result = await toolRegistry.execute('write', { path: 'newfile.txt', content: 'hello world' }, makeContext())
    expect(result.output).toContain('Created')
    expect(readFileSync(join(TMP, 'newfile.txt'), 'utf-8')).toBe('hello world')
  })

  it('overwrites existing file', async () => {
    writeFileSync(join(TMP, 'existing.txt'), 'old content')
    const result = await toolRegistry.execute('write', { path: 'existing.txt', content: 'new content' }, makeContext())
    expect(result.output).toContain('Updated')
    expect(readFileSync(join(TMP, 'existing.txt'), 'utf-8')).toBe('new content')
  })

  it('creates parent directories if not exist', async () => {
    const result = await toolRegistry.execute('write', { path: 'nested/dir/file.txt', content: 'nested' }, makeContext())
    expect(result.output).toContain('Created')
    expect(readFileSync(join(TMP, 'nested/dir/file.txt'), 'utf-8')).toBe('nested')
  })

  it('returns error for content exceeding size limit', async () => {
    const largeContent = 'x'.repeat(11 * 1024 * 1024)
    const result = await toolRegistry.execute(
      'write',
      { path: 'big.txt', content: largeContent },
      { ...makeContext(), maxWriteSizeBytes: 10 * 1024 * 1024 },
    )
    expect(result.output).toContain('too large')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute('write', { path: '../outside.txt', content: 'test' }, makeContext())
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute('write', { path: 'file.txt', content: 'test' }, { sessionId: 'x', workspace: '' })
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error for sensitive path', async () => {
    const result = await toolRegistry.execute('write', { path: '/etc/passwd', content: 'test' }, makeContext())
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
    const result = await toolRegistry.execute('write', { path: 'evil_link/injected.txt', content: 'pwned' }, makeContext())
    expect(result.output).toContain('Cannot access')
  })
})
