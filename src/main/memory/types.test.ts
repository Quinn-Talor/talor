import { describe, it, expect } from 'vitest'
import { estimate, estimateMessage, dbToModelMessages } from './types'
import type { ChatMessage } from '../repos/session-repo'

function makeMsg(role: string, content: unknown): ChatMessage {
  return {
    id: 'test',
    session_id: 's1',
    role: role as ChatMessage['role'],
    content: JSON.stringify(content),
    agent_id: '__chat__',
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('estimate', () => {
  it('estimates English text at ~4 chars per token', () => {
    const english = 'a'.repeat(400)
    const tokens = estimate(english)
    expect(tokens).toBeGreaterThanOrEqual(80)
    expect(tokens).toBeLessThanOrEqual(120)
  })

  it('estimates Chinese text at ~1.5 chars per token', () => {
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
    const msg = makeMsg('tool', [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'read',
        output: { type: 'text', value: 'a'.repeat(400) },
        isError: false,
      },
    ])
    expect(estimateMessage(msg)).toBeGreaterThan(50)
  })

  it('adds fixed cost for images', () => {
    const withImage = makeMsg('user', [{ type: 'image', image: 'data:...' }])
    const withoutImage = makeMsg('user', [{ type: 'text', text: '' }])
    expect(estimateMessage(withImage)).toBeGreaterThan(estimateMessage(withoutImage))
  })
})

describe('dbToModelMessages — tool-result guide injection', () => {
  function toolMsg(toolName: string, output: string, isError = false): ChatMessage {
    return makeMsg('tool', [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName,
        output: { type: 'text', value: output },
        isError,
      },
    ])
  }

  it('tool-result 转 ModelMessage 时拼接结构化指引(给 LLM 看)', () => {
    const rawWrapped = '<tool_output tool="bash">\nhello\n</tool_output>'
    const msg = toolMsg('bash', rawWrapped, false)
    const result = dbToModelMessages([msg])

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('tool')
    const parts = (result[0] as { content: Array<{ output: { value: string } }> }).content
    expect(parts).toHaveLength(1)
    const value = parts[0].output.value

    expect(value).toMatch(/^<tool_output tool="bash">\n\[How to interpret/)
    expect(value).toContain('[bash specifics]')
    expect(value).toContain('[Raw output]')
    expect(value).toContain('hello')
    expect(value).toMatch(/<\/tool_output>$/)
  })

  it('指引随工具名切换(read → read specifics)', () => {
    const msg = toolMsg('read', '<tool_output tool="read">\ncontent\n</tool_output>')
    const result = dbToModelMessages([msg])
    const value = (result[0] as { content: Array<{ output: { value: string } }> }).content[0].output
      .value
    expect(value).toContain('[read specifics]')
    expect(value).not.toContain('[bash specifics]')
  })

  it('未登记工具走 generic fallback 指引', () => {
    const msg = toolMsg(
      'browser_navigate',
      '<tool_output tool="browser_navigate">\n{"ok":true}\n</tool_output>',
    )
    const result = dbToModelMessages([msg])
    const value = (result[0] as { content: Array<{ output: { value: string } }> }).content[0].output
      .value
    expect(value).toContain('[generic tool specifics]')
  })

  it('skill 工具的 trust 标签在指引拼接后仍然保留', () => {
    const msg = toolMsg(
      'skill',
      '<tool_output tool="skill" trust="skill-content">\n[SKILL:foo activated]\n</tool_output>',
    )
    const result = dbToModelMessages([msg])
    const value = (result[0] as { content: Array<{ output: { value: string } }> }).content[0].output
      .value
    expect(value).toMatch(/^<tool_output tool="skill" trust="skill-content">\n\[How to interpret/)
    expect(value).toContain('[skill specifics]')
    expect(value).toContain('[SKILL:foo activated]')
  })
})
