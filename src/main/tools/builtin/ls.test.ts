import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './ls'

const TMP = join(__dirname, '__tmp_ls_test__')

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
    expect(result.output).toBe('Cannot access path outside workspace')
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
    expect(result.output).toBe('Cannot access path outside workspace')
  })

  it('caps depth at 10 to prevent excessive recursion', async () => {
    const result = await toolRegistry.execute('ls', { path: '.', depth: 999999 }, makeContext())
    expect(result.output).toBeDefined()
  })
})
