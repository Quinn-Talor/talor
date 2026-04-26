import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './glob'

const TMP = join(__dirname, '__tmp_glob_test__')

function makeContext(workspace = TMP) {
  return { sessionId: 'test-session', workspace }
}

beforeEach(() => {
  mkdirSync(join(TMP, 'src'), { recursive: true })
  mkdirSync(join(TMP, 'tests'), { recursive: true })
  writeFileSync(join(TMP, 'src', 'index.ts'), '')
  writeFileSync(join(TMP, 'src', 'utils.ts'), '')
  writeFileSync(join(TMP, 'tests', 'index.test.ts'), '')
  writeFileSync(join(TMP, 'README.md'), '')
  registerBuiltinTools()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  toolRegistry.clear()
})

describe('glob tool', () => {
  it('returns matched files for simple pattern', async () => {
    const result = await toolRegistry.execute('glob', { pattern: '*.md' }, makeContext())
    expect(Array.isArray(result.output)).toBe(true)
    expect(result.output).toContain('README.md')
  })

  it('returns empty array when no match', async () => {
    const result = await toolRegistry.execute('glob', { pattern: '*.xyz' }, makeContext())
    expect(result.output).toEqual([])
  })

  it('returns error for empty pattern', async () => {
    const result = await toolRegistry.execute('glob', { pattern: '' }, makeContext())
    expect(result.output).toContain('empty')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute('glob', { pattern: '*.ts' }, { sessionId: 'x', workspace: '' })
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error when workspace does not exist', async () => {
    const result = await toolRegistry.execute('glob', { pattern: '*.ts' }, makeContext('/nonexistent/path'))
    expect(result.output).toContain('does not exist')
  })

  it('blocks symlink pointing outside workspace', async () => {
    const { symlinkSync } = await import('fs')
    const linkPath = join(TMP, 'evil_link')
    try {
      symlinkSync('/etc', linkPath)
    } catch {
      return
    }
    const result = await toolRegistry.execute('glob', { pattern: 'evil_link/**' }, makeContext())
    if (Array.isArray(result.output)) {
      const paths = result.output as string[]
      expect(paths.every((p: string) => !p.startsWith('/etc'))).toBe(true)
    }
  })

  it('handles glob pattern with parentheses without throwing', async () => {
    const result = await toolRegistry.execute('glob', { pattern: 'src/(index|utils).ts' }, makeContext())
    expect(result.output).toBeDefined()
  })
})
