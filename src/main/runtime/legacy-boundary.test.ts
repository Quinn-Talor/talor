// 依赖边界（D2 AC-009）：旧运行时与它的专属模块已删除，源码里（含测试）没有任何导入或 mock 指向它们。
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

const SRC = resolve(__dirname, '../..')

/** 已删除的旧路径（相对 src/，目录以 / 结尾）。 */
const LEGACY_PATHS = [
  'main/loop/',
  'main/prompt/',
  'main/memory/',
  'main/mcp/',
  'main/chat/orchestrator.ts',
  'main/chat/events.ts',
  'main/history/session-summary.ts',
  'main/agent/agent.ts',
  'main/agent/agent-toolset.ts',
  'main/agent/delegate-agent.ts',
  'main/agent/builtin-registry.ts',
  'main/skills/skill-tool.ts',
  'main/tools/build-tools.ts',
  'main/tools/risk-gate.ts',
  'main/tools/session-approval-memory.ts',
  'main/tools/builtin/search-tool.ts',
  'main/tools/builtin/request-continuation.ts',
  'main/repos/side-effect-ledger.ts',
  'main/repos/reflection-ledger.ts',
  'main/repos/trace-repo.ts',
  'main/observe/trace-recorder.ts',
  'main/observe/trace-invariants.ts',
  'main/providers/middleware/trace.ts',
]

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : []
  })
}

const SPECIFIER =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|vi\.mock\(\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g

/** 说明符解析为相对 src/ 的路径（不补扩展名）；非本仓库路径返回 null。 */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('.')) return relative(SRC, resolve(dirname(file), spec))
  if (spec.startsWith('@shared/')) return `shared/${spec.slice('@shared/'.length)}`
  if (spec.startsWith('@/')) return `renderer/${spec.slice(2)}`
  return null
}

function isLegacy(path: string): boolean {
  return LEGACY_PATHS.some((p) =>
    p.endsWith('/')
      ? path === p.slice(0, -1) || path.startsWith(p)
      : path === p || `${path}.ts` === p,
  )
}

describe('legacy boundary', () => {
  it('AC-009 the legacy paths no longer exist', () => {
    for (const p of LEGACY_PATHS) expect(existsSync(join(SRC, p)), p).toBe(false)
  })

  it('AC-009 no source or test file imports or mocks a legacy path', () => {
    const files = ['main', 'preload', 'renderer', 'shared'].flatMap((d) => walk(join(SRC, d)))
    expect(files.length).toBeGreaterThan(100)
    const hits: string[] = []
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? m[4]!
        const t = target(file, spec)
        if (t !== null && isLegacy(t)) hits.push(`${relative(SRC, file)} -> ${spec}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('detects a legacy specifier (the check is not vacuous)', () => {
    const file = join(SRC, 'main/ipc/x.ts')
    expect(isLegacy(target(file, '../mcp/client')!)).toBe(true)
    expect(isLegacy(target(file, '../loop')!)).toBe(true)
    expect(isLegacy(target(file, '../agent/agent')!)).toBe(true)
    expect(isLegacy(target(file, '../agent/agent-manager')!)).toBe(false)
    expect(isLegacy(target(file, '../runtime/mcp-status')!)).toBe(false)
  })
})
