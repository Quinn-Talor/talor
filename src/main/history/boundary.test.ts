// 边界测试（C3 AC-009）：history/ 不引用 D2 要删除的旧路径目录。
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const HISTORY_DIR = __dirname
const sources = readdirSync(HISTORY_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => join(HISTORY_DIR, f))

describe('history boundary', () => {
  it('AC-009 does not import memory/, prompt/, loop/ or chat/orchestrator', () => {
    expect(sources.length).toBeGreaterThanOrEqual(3)
    for (const file of sources) {
      const code = readFileSync(file, 'utf8')
      const specifiers = [...code.matchAll(/(?:from\s+|import\()'([^']+)'/g)].map((m) => m[1]!)
      expect(specifiers.length, file).toBeGreaterThan(0)
      for (const spec of specifiers) {
        expect(spec, file).not.toMatch(/^\.\.\/(memory|prompt|loop)\//)
        expect(spec, file).not.toMatch(/chat\/orchestrator/)
      }
    }
  })
})
