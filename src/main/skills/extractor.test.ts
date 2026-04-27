import { describe, it, expect } from 'vitest'
import { extractActivatedSkills } from './extractor'
import type { ContentBlock } from '@shared/types/message'

interface SimpleMessage {
  role: string
  content: ContentBlock[]
}

function makeToolUse(toolName: string, input: unknown): ContentBlock {
  return { type: 'tool_use', toolCallId: `tc-${toolName}`, toolName, input }
}

function makeToolResult(toolName: string, output: string): ContentBlock {
  return { type: 'tool_result', toolCallId: `tc-${toolName}`, toolName, output, isError: false }
}

describe('extractActivatedSkills', () => {
  it('AC-S5-01: extracts activated skills from tool_use records', () => {
    const messages: SimpleMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '帮我查表格' }] },
      {
        role: 'assistant',
        content: [
          makeToolUse('skill', { name: 'lark-sheets' }),
        ],
      },
      {
        role: 'assistant',
        content: [
          makeToolResult('skill', '[SKILL:lark-sheets activated]\n# sheets'),
        ],
      },
      {
        role: 'assistant',
        content: [
          makeToolUse('skill', { name: 'lark-shared' }),
        ],
      },
    ]

    const result = extractActivatedSkills(messages)
    expect(result).toEqual(['lark-sheets', 'lark-shared'])
  })

  it('AC-S5-02: returns empty for no skill tool calls', () => {
    const messages: SimpleMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      {
        role: 'assistant',
        content: [
          makeToolUse('bash', { command: 'ls' }),
        ],
      },
    ]

    const result = extractActivatedSkills(messages)
    expect(result).toEqual([])
  })

  it('deduplicates repeated skill activations', () => {
    const messages: SimpleMessage[] = [
      {
        role: 'assistant',
        content: [makeToolUse('skill', { name: 'lark-sheets' })],
      },
      {
        role: 'assistant',
        content: [makeToolUse('skill', { name: 'lark-sheets' })],
      },
    ]

    const result = extractActivatedSkills(messages)
    expect(result).toEqual(['lark-sheets'])
  })

  it('handles empty messages', () => {
    expect(extractActivatedSkills([])).toEqual([])
  })
})
