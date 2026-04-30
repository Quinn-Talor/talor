import { describe, it, expect } from 'vitest'
import { estimate, estimateMessage, messagesToCoreMessages } from './types'
import type { ChatMessage } from '../repos/session-repo'

function makeMsg(content: object): ChatMessage {
  return {
    id: 'test',
    session_id: 's1',
    role: 'user',
    content: JSON.stringify(content),
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('estimate', () => {
  it('estimates English text at ~4 chars per token', () => {
    // 400 chars of English → ~100 tokens
    const english = 'a'.repeat(400)
    const tokens = estimate(english)
    expect(tokens).toBeGreaterThanOrEqual(80)
    expect(tokens).toBeLessThanOrEqual(120)
  })

  it('estimates Chinese text at ~1.5 chars per token', () => {
    // 150 Chinese chars → ~100 tokens
    const chinese = '中'.repeat(150)
    const tokens = estimate(chinese)
    expect(tokens).toBeGreaterThanOrEqual(80)
    expect(tokens).toBeLessThanOrEqual(130)
  })

  it('Chinese text estimates more tokens than same-length English', () => {
    const sameLength = 'a'.repeat(100)
    const chinese = '中'.repeat(100)
    expect(estimate(chinese)).toBeGreaterThan(estimate(sameLength))
  })
})

describe('estimateMessage', () => {
  it('includes tool result text in estimate', () => {
    const msg = makeMsg([{ type: 'tool_result', toolCallId: 'c1', toolName: 'read', output: 'a'.repeat(400), isError: false }])
    expect(estimateMessage(msg)).toBeGreaterThan(50)
  })

  it('adds fixed cost for images', () => {
    const withImage = makeMsg([{ type: 'image', image: 'data:...', mimeType: 'image/png' }])
    const withoutImage = makeMsg([{ type: 'text', text: '' }])
    expect(estimateMessage(withImage)).toBeGreaterThan(estimateMessage(withoutImage))
  })
})

describe('messagesToCoreMessages — tool_result guide injection', () => {
  function toolMsg(toolName: string, output: string, isError = false): ChatMessage {
    return {
      id: 't1',
      session_id: 's1',
      role: 'tool',
      content: JSON.stringify([{ type: 'tool_result', toolCallId: 'c1', toolName, output, isError }]),
      created_at: '2026-01-01T00:00:00.000Z',
    }
  }

  it('tool_result 转 CoreMessage 时拼接结构化指引(给 LLM 看)', () => {
    // DB 里的 output 是 raw wrap
    const rawWrapped = '<tool_output tool="bash">\nhello\n</tool_output>'
    const msg = toolMsg('bash', rawWrapped, false)
    const core = messagesToCoreMessages([msg])

    expect(core).toHaveLength(1)
    expect(core[0].role).toBe('tool')
    const parts = (core[0].content as Array<{ output: { value: string } }>)
    expect(parts).toHaveLength(1)
    const value = parts[0].output.value

    // 指引必须被拼到 tool_output 开标签之后
    expect(value).toMatch(/^<tool_output tool="bash">\n\[How to interpret/)
    // bash specifics 命中
    expect(value).toContain('[bash specifics]')
    // Raw section 保留
    expect(value).toContain('[Raw output]')
    expect(value).toContain('hello')
    // 关闭标签保留
    expect(value).toMatch(/<\/tool_output>$/)
  })

  it('指引随工具名切换(read → read specifics)', () => {
    const msg = toolMsg('read', '<tool_output tool="read">\ncontent\n</tool_output>')
    const core = messagesToCoreMessages([msg])
    const value = (core[0].content as Array<{ output: { value: string } }>)[0].output.value
    expect(value).toContain('[read specifics]')
    expect(value).not.toContain('[bash specifics]')
  })

  it('未登记工具走 generic fallback 指引', () => {
    const msg = toolMsg('browser_navigate', '<tool_output tool="browser_navigate">\n{"ok":true}\n</tool_output>')
    const core = messagesToCoreMessages([msg])
    const value = (core[0].content as Array<{ output: { value: string } }>)[0].output.value
    expect(value).toContain('[generic tool specifics]')
  })

  it('skill 工具的 trust 标签在指引拼接后仍然保留', () => {
    const msg = toolMsg('skill', '<tool_output tool="skill" trust="skill-content">\n[SKILL:foo activated]\n</tool_output>')
    const core = messagesToCoreMessages([msg])
    const value = (core[0].content as Array<{ output: { value: string } }>)[0].output.value
    expect(value).toMatch(/^<tool_output tool="skill" trust="skill-content">\n\[How to interpret/)
    expect(value).toContain('[skill specifics]')
    expect(value).toContain('[SKILL:foo activated]')
  })
})
