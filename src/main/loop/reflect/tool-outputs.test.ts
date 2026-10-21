import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockListBySession } = vi.hoisted(() => ({ mockListBySession: vi.fn() }))

vi.mock('../../repos/session-repo', () => ({
  messageRepo: { listBySession: mockListBySession },
}))

import { collectRecentToolOutputs, toolResultBlockText } from './tool-outputs'

function toolMsg(blocks: unknown[]) {
  return { role: 'tool', content: JSON.stringify(blocks) }
}

beforeEach(() => {
  mockListBySession.mockReset()
})

describe('toolResultBlockText', () => {
  it('SDK 原生格式 {type:tool-result, output:{type:text, value}} → value', () => {
    expect(
      toolResultBlockText({
        type: 'tool-result',
        toolCallId: 'c',
        toolName: 'read',
        output: { type: 'text', value: 'hello' },
      }),
    ).toBe('hello')
  })

  it('早期格式 {type:tool_result, output:string} → output', () => {
    expect(toolResultBlockText({ type: 'tool_result', output: 'legacy' })).toBe('legacy')
  })

  it('(不触发) 非 tool result block / 空输出 → null', () => {
    expect(toolResultBlockText({ type: 'text', text: 'x' })).toBeNull()
    expect(toolResultBlockText({ type: 'tool-result', output: { type: 'text', value: '' } })).toBe(
      null,
    )
    expect(toolResultBlockText(null)).toBeNull()
  })
})

describe('collectRecentToolOutputs', () => {
  it('从 DB 真实格式的 tool 消息取输出, 新的在前', () => {
    mockListBySession.mockReturnValue([
      toolMsg([{ type: 'tool-result', output: { type: 'text', value: 'old' } }]),
      { role: 'assistant', content: JSON.stringify([{ type: 'text', text: 'mid' }]) },
      toolMsg([
        { type: 'tool-result', output: { type: 'text', value: 'new-a' } },
        { type: 'tool-result', output: { type: 'text', value: 'new-b' } },
      ]),
    ])
    expect(collectRecentToolOutputs('s', 10)).toEqual(['new-a', 'new-b', 'old'])
  })

  it('新旧格式混合都能取到', () => {
    mockListBySession.mockReturnValue([
      toolMsg([{ type: 'tool_result', output: 'legacy' }]),
      toolMsg([{ type: 'tool-result', output: { type: 'text', value: 'current' } }]),
    ])
    expect(collectRecentToolOutputs('s', 10)).toEqual(['current', 'legacy'])
  })

  it('取满 k 条即停', () => {
    mockListBySession.mockReturnValue([
      toolMsg([{ type: 'tool-result', output: { type: 'text', value: 'a' } }]),
      toolMsg([{ type: 'tool-result', output: { type: 'text', value: 'b' } }]),
    ])
    expect(collectRecentToolOutputs('s', 1)).toEqual(['b'])
  })

  it('(不触发) 无 tool 消息 / 内容非 JSON → 空', () => {
    mockListBySession.mockReturnValue([
      { role: 'user', content: '"hi"' },
      { role: 'tool', content: 'not json' },
    ])
    expect(collectRecentToolOutputs('s', 10)).toEqual([])
  })
})
