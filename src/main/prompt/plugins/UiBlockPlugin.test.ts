import { describe, it, expect } from 'vitest'
import { UiBlockPlugin } from './UiBlockPlugin'
import type { PipelineContext } from '../types'

function makeCtx(): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },

    provider: {} as any,

    providerConfig: {} as any,
    workspacePath: undefined,
  }
}

describe('UiBlockPlugin', () => {
  it('emits exactly one system message containing the block protocol', async () => {
    const plugin = new UiBlockPlugin()
    const result = await plugin.build(makeCtx())
    expect(result.messages).toHaveLength(1)
    const msg = result.messages[0]
    expect(msg.role).toBe('system')
    expect(typeof msg.content).toBe('string')
  })

  it('mentions all 5 block types', async () => {
    const plugin = new UiBlockPlugin()
    const result = await plugin.build(makeCtx())
    const content = result.messages[0].content as string
    expect(content).toContain('"type": "need_input"')
    expect(content).toContain('"type": "proposal"')
    expect(content).toContain('"type": "done"')
    expect(content).toContain('"type": "blocked"')
    expect(content).toContain('"type": "warning"')
  })

  it('includes the fenced talor language tag', async () => {
    const plugin = new UiBlockPlugin()
    const result = await plugin.build(makeCtx())
    const content = result.messages[0].content as string
    expect(content).toContain('```talor')
  })

  it('emits no tools', async () => {
    const plugin = new UiBlockPlugin()
    const result = await plugin.build(makeCtx())
    expect(result.tools).toEqual([])
  })

  it('reports a token estimate > 0', async () => {
    const plugin = new UiBlockPlugin()
    const result = await plugin.build(makeCtx())
    expect(result.tokenEstimate).toBeGreaterThan(0)
  })

  it('name is "UiBlockPlugin"', () => {
    expect(new UiBlockPlugin().name).toBe('UiBlockPlugin')
  })
})
