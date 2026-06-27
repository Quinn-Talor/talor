import { describe, it, expect } from 'vitest'
import { applyAnthropicCacheBreakpoints } from './cache-breakpoints'
import type { ModelMessage } from 'ai'
import type { StabilityLayer } from './types'

const msg = (content: string): ModelMessage => ({ role: 'system', content })
const seg = (layer: StabilityLayer, ...contents: string[]) => ({
  layer,
  messages: contents.map(msg),
})

const cc = (m: ModelMessage | undefined) =>
  (m?.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)?.anthropic
    ?.cacheControl

describe('applyAnthropicCacheBreakpoints', () => {
  it('static + history 各打一个断点(末条 message)', () => {
    const segments = [
      seg('system', 'charter'),
      seg('agent', 'agent-prompt', 'ui-block'),
      seg('history', 'h1', 'h2'),
      seg('volatile', 'current-turn'),
    ]
    applyAnthropicCacheBreakpoints(segments)

    // static 断点 → 最后一个 static segment(agent)末条
    expect(cc(segments[1].messages[1])).toEqual({ type: 'ephemeral' })
    // 非末条不标
    expect(cc(segments[1].messages[0])).toBeUndefined()
    // history 断点 → history 末条
    expect(cc(segments[2].messages[1])).toEqual({ type: 'ephemeral' })
    expect(cc(segments[2].messages[0])).toBeUndefined()
  })

  it('volatile 永不标(当前 turn 每轮变)', () => {
    const segments = [seg('system', 'charter'), seg('volatile', 'current-turn')]
    applyAnthropicCacheBreakpoints(segments)
    expect(cc(segments[1].messages[0])).toBeUndefined()
  })

  it('无 history 时只标一个断点(static==stable 同段)', () => {
    const segments = [seg('system', 'charter'), seg('agent', 'a1'), seg('volatile', 'turn')]
    applyAnthropicCacheBreakpoints(segments)
    expect(cc(segments[1].messages[0])).toEqual({ type: 'ephemeral' })
    // 没有第二个 stable 段可标 → system 段不重复标
    expect(cc(segments[0].messages[0])).toBeUndefined()
  })

  it('只有 system 时标在 system 末条', () => {
    const segments = [seg('system', 'a', 'b')]
    applyAnthropicCacheBreakpoints(segments)
    expect(cc(segments[0].messages[1])).toEqual({ type: 'ephemeral' })
    expect(cc(segments[0].messages[0])).toBeUndefined()
  })

  it('合并已有 providerOptions,不覆盖其他 namespace', () => {
    const segments = [
      {
        layer: 'system' as StabilityLayer,
        messages: [
          {
            role: 'system',
            content: 'x',
            providerOptions: { openai: { foo: 1 }, anthropic: { bar: 2 } },
          } as ModelMessage,
        ],
      },
    ]
    applyAnthropicCacheBreakpoints(segments)
    const po = segments[0].messages[0].providerOptions as Record<string, Record<string, unknown>>
    expect(po.openai).toEqual({ foo: 1 })
    expect(po.anthropic.bar).toBe(2)
    expect(po.anthropic.cacheControl).toEqual({ type: 'ephemeral' })
  })

  it('空 segments 不抛', () => {
    expect(() => applyAnthropicCacheBreakpoints([])).not.toThrow()
  })
})
