import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './grep'

const TMP = join(__dirname, '__tmp_grep_test__')
const OUTSIDE = join(__dirname, '__tmp_grep_test__-outside')

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
  rmSync(OUTSIDE, { recursive: true, force: true })
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
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'HELLO', caseSensitive: true },
      makeContext(),
    )
    expect(result.output).toBe('No matches found')
  })

  it('searches in specific path', async () => {
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'function', path: 'src' },
      makeContext(),
    )
    expect(result.output).toContain('code.ts')
  })

  it('returns error for invalid regex', async () => {
    const result = await toolRegistry.execute('grep', { pattern: '[invalid' }, makeContext())
    expect(result.output).toContain('Invalid regex')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'test', path: '../outside' },
      makeContext(),
    )
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'test' },
      { sessionId: 'x', workspace: '' },
    )
    expect(result.output).toContain('Workspace not set')
  })

  it('filters by include pattern', async () => {
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'hello', include: '*.txt' },
      makeContext(),
    )
    expect(result.output).toContain('file1.txt')
    expect(result.output).not.toContain('code.ts')
  })

  it('rejects catastrophic backtracking regex (ReDoS)', async () => {
    const start = Date.now()
    const result = await toolRegistry.execute(
      'grep',
      { pattern: '(a+)+b', path: 'file1.txt' },
      makeContext(),
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
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'root', path: 'evil_link' },
      makeContext(),
    )
    expect(result.output).toBe('Cannot access sensitive system path')
  })

  it('blocks symlink pointing to non-sensitive dir outside workspace (needs consent)', async () => {
    const { symlinkSync } = await import('fs')
    mkdirSync(OUTSIDE, { recursive: true })
    symlinkSync(OUTSIDE, join(TMP, 'out_link'))
    const result = await toolRegistry.execute(
      'grep',
      { pattern: 'x', path: 'out_link' },
      makeContext(),
    )
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  describe('include 过滤', () => {
    beforeEach(() => {
      writeFileSync(join(TMP, 'src', 'view.tsx'), 'hello tsx')
      writeFileSync(join(TMP, 'src', 'code.test.ts'), 'hello test')
      writeFileSync(join(TMP, 'src', 'types.d.ts'), 'hello dts')
      writeFileSync(join(TMP, 'app.log'), 'hello log')
    })

    it('花括号 include *.{ts,tsx} 只搜 ts/tsx', async () => {
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'hello', include: '*.{ts,tsx}' },
        makeContext(),
      )
      const out = String(result.output)
      expect(out).toContain('view.tsx')
      expect(out).toContain('code.ts')
      expect(out).not.toContain('file1.txt')
      expect(out).not.toContain('app.log')
    })

    it('多点扩展名 *.test.ts 只匹配测试文件', async () => {
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'hello', include: '*.test.ts' },
        makeContext(),
      )
      const out = String(result.output)
      expect(out).toContain('code.test.ts')
      expect(out).not.toContain('code.ts:')
      expect(out).not.toContain('types.d.ts')
    })

    it('多点扩展名 *.d.ts 只匹配声明文件', async () => {
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'hello', include: '*.d.ts' },
        makeContext(),
      )
      const out = String(result.output)
      expect(out).toContain('types.d.ts')
      expect(out).not.toContain('code.test.ts')
    })

    it('默认 include 只搜常见文本扩展名,跳过 .log', async () => {
      const result = await toolRegistry.execute('grep', { pattern: 'hello' }, makeContext())
      const out = String(result.output)
      expect(out).toContain('file1.txt')
      expect(out).toContain('view.tsx')
      expect(out).not.toContain('app.log')
    })

    it('include 含 / 时按相对搜索根的路径匹配', async () => {
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'hello', include: 'src/*.tsx' },
        makeContext(),
      )
      const out = String(result.output)
      expect(out).toContain('view.tsx')
      expect(out).not.toContain('file1.txt')
    })
  })

  describe('文件数上限', () => {
    it('候选文件超过上限 → 输出明确提示被截断', async () => {
      const many = join(TMP, 'many')
      mkdirSync(many)
      for (let i = 0; i <= 5000; i++) writeFileSync(join(many, `f${i}.txt`), 'nothing')
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'needle', path: 'many' },
        makeContext(),
      )
      const out = String(result.output)
      expect(out).toContain('No matches found')
      expect(out).toContain('file limit reached')
    }, 30000)

    it('文件数未超上限 → 无截断提示', async () => {
      const result = await toolRegistry.execute('grep', { pattern: 'hello' }, makeContext())
      expect(String(result.output)).not.toContain('file limit reached')
    })

    it('匹配超过 100 条按匹配数截断,而非按文件数', async () => {
      const lines = Array.from({ length: 150 }, () => 'needle').join('\n')
      writeFileSync(join(TMP, 'needles.txt'), lines)
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'needle', path: 'needles.txt' },
        makeContext(),
      )
      const out = String(result.output)
      expect(out).toContain('(truncated, showing first 100 matches)')
      expect(out.match(/^--- /gm)?.length).toBe(100)
    })
  })

  describe('已授权的 workspace 外目录', () => {
    beforeEach(() => {
      mkdirSync(join(OUTSIDE, 'sub'), { recursive: true })
      writeFileSync(join(OUTSIDE, 'sub', 'ext.md'), 'hello outside')
    })

    it('用户批准后能搜到外部目录内文件', async () => {
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'hello', path: OUTSIDE },
        { ...makeContext(), requestPermission: async () => true },
      )
      expect(String(result.output)).toContain('ext.md')
    })

    it('用户拒绝 → 不搜索', async () => {
      const result = await toolRegistry.execute(
        'grep',
        { pattern: 'hello', path: OUTSIDE },
        { ...makeContext(), requestPermission: async () => false },
      )
      expect(String(result.output)).toContain('user denied')
    })
  })
})
