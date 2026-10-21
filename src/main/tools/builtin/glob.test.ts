import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools, globToRegex, expandBraces } from './glob'

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
    const result = await toolRegistry.execute(
      'glob',
      { pattern: '*.ts' },
      { sessionId: 'x', workspace: '' },
    )
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error when workspace does not exist', async () => {
    const result = await toolRegistry.execute(
      'glob',
      { pattern: '*.ts' },
      makeContext('/nonexistent/path'),
    )
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
    const result = await toolRegistry.execute(
      'glob',
      { pattern: 'src/(index|utils).ts' },
      makeContext(),
    )
    expect(result.output).toBeDefined()
  })

  describe('glob 语法', () => {
    beforeEach(() => {
      mkdirSync(join(TMP, 'src', 'components', 'deep'), { recursive: true })
      writeFileSync(join(TMP, 'src', 'components', 'Button.tsx'), '')
      writeFileSync(join(TMP, 'src', 'components', 'deep', 'Card.tsx'), '')
      writeFileSync(join(TMP, 'vite.config.ts'), '')
      writeFileSync(join(TMP, 'App.tsx'), '')
    })

    async function globPaths(pattern: string): Promise<string[]> {
      const result = await toolRegistry.execute('glob', { pattern }, makeContext())
      expect(Array.isArray(result.output)).toBe(true)
      return result.output as string[]
    }

    it('**/*.ts 匹配任意层级(含根目录)', async () => {
      const paths = await globPaths('**/*.ts')
      expect(paths).toEqual(
        expect.arrayContaining(['vite.config.ts', 'src/index.ts', 'tests/index.test.ts']),
      )
      expect(paths).not.toContain('App.tsx')
    })

    it('src/**/*.tsx 匹配 src 下零或多层目录', async () => {
      const paths = await globPaths('src/**/*.tsx')
      expect(paths.sort()).toEqual(['src/components/Button.tsx', 'src/components/deep/Card.tsx'])
    })

    it('*.{ts,tsx} 花括号展开,只匹配根目录', async () => {
      const paths = await globPaths('*.{ts,tsx}')
      expect(paths.sort()).toEqual(['App.tsx', 'vite.config.ts'])
    })

    it('根目录 *.ts 不匹配子目录文件', async () => {
      const paths = await globPaths('*.ts')
      expect(paths).toEqual(['vite.config.ts'])
    })

    it('globToRegex: * 不跨目录,? 匹配单字符,正则元字符按字面量', () => {
      expect(globToRegex('src/*.ts').test('src/a/b.ts')).toBe(false)
      expect(globToRegex('a?.md').test('ab.md')).toBe(true)
      expect(globToRegex('a?.md').test('a/.md')).toBe(false)
      expect(globToRegex('(x).ts').test('(x).ts')).toBe(true)
      expect(globToRegex('*.ts').test('ats')).toBe(false)
    })

    it('expandBraces: 多组/嵌套展开,无逗号花括号保留字面量', () => {
      expect(expandBraces('{a,b}.{c,d}').sort()).toEqual(['a.c', 'a.d', 'b.c', 'b.d'])
      expect(expandBraces('x.{ts,{js,jsx}}').sort()).toEqual(['x.js', 'x.jsx', 'x.ts'])
      expect(expandBraces('{x}.ts')).toEqual(['{x}.ts'])
    })
  })
})
