import { describe, it, expect } from 'vitest'
import { RuntimeMetaPlugin } from './RuntimeMetaPlugin'
import type { PipelineContext } from '../types'

function makeCtx(workspacePath?: string): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as PipelineContext['provider'],
    providerConfig: {} as PipelineContext['providerConfig'],
    workspacePath,
  }
}

describe('RuntimeMetaPlugin', () => {
  it('属 volatile 层(易变尾部,不进可缓存前缀)', () => {
    expect(new RuntimeMetaPlugin().layer).toBe('volatile')
  })

  it('含 workspace', async () => {
    const r = await new RuntimeMetaPlugin().build(makeCtx('/my/workspace'))
    expect(r.messages[0].content as string).toContain('Workspace: /my/workspace')
  })

  it('workspace 未设置时显示 (not set)', async () => {
    const r = await new RuntimeMetaPlugin().build(makeCtx())
    expect(r.messages[0].content as string).toContain('Workspace: (not set)')
  })

  it('日期是日期级(YYYY-MM-DD),非毫秒时间戳', async () => {
    const r = await new RuntimeMetaPlugin().build(makeCtx())
    const content = r.messages[0].content as string
    expect(content).toMatch(/Current date: \d{4}-\d{2}-\d{2}\b/)
    expect(content).not.toMatch(/Current date:.*T\d{2}:\d{2}/) // 不含时间部分
  })
})
