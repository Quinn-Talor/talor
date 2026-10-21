import { describe, it, expect, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
}))
vi.mock('electron', () => electronMock)

import { buildInputSummary } from './tool-confirm'

describe('buildInputSummary', () => {
  it('edit: 摘要同时包含路径、旧片段与新片段', () => {
    const summary = buildInputSummary('edit', {
      path: 'src/a.ts',
      old: 'const OLD_VALUE = 1',
      new: 'const NEW_VALUE = 2',
    })
    expect(summary).toContain('src/a.ts')
    expect(summary).toContain('OLD_VALUE')
    expect(summary).toContain('NEW_VALUE')
  })

  it('edit: 旧片段很长时新片段仍在 500 字符预算内可见', () => {
    const summary = buildInputSummary('edit', {
      path: 'a.ts',
      old: 'x'.repeat(2000),
      new: 'NEW_MARKER',
    })
    expect(summary.length).toBeLessThanOrEqual(500)
    expect(summary).toContain('NEW_MARKER')
  })

  it('write: 摘要不含 edit 的新旧片段标签', () => {
    const summary = buildInputSummary('write', { path: 'a.ts', content: 'hello' })
    expect(summary).toContain('hello')
    expect(summary).not.toContain('旧内容')
    expect(summary).not.toContain('新内容')
  })
})
