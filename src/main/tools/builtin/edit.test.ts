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
    const result = await toolRegistry.execute('edit', { path: 'file.txt', old: 'world', new: 'universe' }, makeContext())
    expect(result.output).toContain('Edited')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('hello universe')
  })

  it('replaces all occurrences when replaceAll is true', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'foo bar foo baz')
    const result = await toolRegistry.execute('edit', { path: 'file.txt', old: 'foo', new: 'qux', replaceAll: true }, makeContext())
    expect(result.output).toContain('2 replacement')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('qux bar qux baz')
  })

  it('replaces only first occurrence by default', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'foo bar foo baz')
    const result = await toolRegistry.execute('edit', { path: 'file.txt', old: 'foo', new: 'qux' }, makeContext())
    expect(result.output).toContain('1 replacement')
    expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('qux bar foo baz')
  })

  it('returns error for string not found', async () => {
    writeFileSync(join(TMP, 'file.txt'), 'hello world')
    const result = await toolRegistry.execute('edit', { path: 'file.txt', old: 'nonexistent', new: 'replacement' }, makeContext())
    expect(result.output).toContain('String not found')
  })

  it('returns error for non-existent file', async () => {
    const result = await toolRegistry.execute('edit', { path: 'nonexistent.txt', old: 'old', new: 'new' }, makeContext())
    expect(result.output).toContain('not found')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute('edit', { path: '../outside.txt', old: 'old', new: 'new' }, makeContext())
    expect(result.output).toBe('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute('edit', { path: 'file.txt', old: 'old', new: 'new' }, { sessionId: 'x', workspace: '' })
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error for sensitive path', async () => {
    const result = await toolRegistry.execute('edit', { path: '/etc/passwd', old: 'old', new: 'new' }, makeContext())
    expect(result.output).toBe('Cannot access sensitive system path')
  })
})
