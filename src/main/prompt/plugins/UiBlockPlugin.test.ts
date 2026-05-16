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
    // Accept either compact (no space) or canonical (with space) JSON formatting.
    for (const type of ['need_input', 'proposal', 'done', 'blocked', 'warning']) {
      expect(content).toMatch(new RegExp(`"type":\\s*"${type}"`))
    }
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

  it('opts out when agent.profile.preferences.disableUiBlocks=true', async () => {
    const plugin = new UiBlockPlugin()
    const ctx = makeCtx()

    ;(ctx as any).agent = {
      profile: { preferences: { disableUiBlocks: true } },
    }
    const result = await plugin.build(ctx)
    expect(result.messages).toEqual([])
    expect(result.tools).toEqual([])
    expect(result.tokenEstimate).toBe(0)
  })

  it('injects normally when disableUiBlocks is false or unset', async () => {
    const plugin = new UiBlockPlugin()
    const ctx = makeCtx()

    ;(ctx as any).agent = {
      profile: { preferences: { disableUiBlocks: false } },
    }
    const result = await plugin.build(ctx)
    expect(result.messages).toHaveLength(1)
  })
})
