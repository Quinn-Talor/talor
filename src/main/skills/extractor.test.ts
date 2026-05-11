import { describe, it, expect } from 'vitest'
import { extractActivatedSkills } from './extractor'

function makeToolCall(toolName: string, input: unknown) {
  return { type: 'tool_use', toolCallId: `tc-${toolName}`, toolName, input }
}

describe('extractActivatedSkills', () => {
  it('AC-S5-01: extracts activated skills from tool-call records', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '帮我查表格' }] },
      { role: 'assistant', content: [makeToolCall('skill', { name: 'lark-sheets' })] },
      { role: 'assistant', content: [makeToolCall('skill', { name: 'lark-shared' })] },
    ]

    const result = extractActivatedSkills(messages)
    expect(result).toEqual(['lark-sheets', 'lark-shared'])
  })

  it('AC-S5-02: returns empty for no skill tool calls', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      { role: 'assistant', content: [makeToolCall('bash', { command: 'ls' })] },
    ]

    const result = extractActivatedSkills(messages)
    expect(result).toEqual([])
  })

  it('deduplicates repeated skill activations', () => {
    const messages = [
      { role: 'assistant', content: [makeToolCall('skill', { name: 'lark-sheets' })] },
      { role: 'assistant', content: [makeToolCall('skill', { name: 'lark-sheets' })] },
    ]

    const result = extractActivatedSkills(messages)
    expect(result).toEqual(['lark-sheets'])
  })

  it('handles empty messages', () => {
    expect(extractActivatedSkills([])).toEqual([])
  })
})
