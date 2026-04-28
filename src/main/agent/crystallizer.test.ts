import { describe, it, expect } from 'vitest'
import { extractDependenciesFromMessages } from './crystallizer'
import type { ContentBlock } from '@shared/types/message'

describe('extractDependenciesFromMessages', () => {
  it('AC-E3-01: extracts tools, filtering ALWAYS_AVAILABLE', () => {
    const messages: Array<{ role: string; content: ContentBlock[] }> = [
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-1', toolName: 'bash', input: { command: 'echo hi' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-2', toolName: 'read', input: { path: '/tmp' } },
      ]},
    ]

    const result = extractDependenciesFromMessages(messages)
    expect(result.tools).toEqual(['bash'])
    expect(result.tools).not.toContain('read')
  })

  it('AC-E3-01: extracts skills from [SKILL:xxx activated] markers', () => {
    const messages: Array<{ role: string; content: ContentBlock[] }> = [
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-1', toolName: 'skill', input: { name: 'lark-sheets' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_result', toolCallId: 'tc-1', toolName: 'skill',
          output: '[SKILL:lark-sheets activated]\n\n# lark-sheets\ncontent', isError: false },
      ]},
    ]

    const result = extractDependenciesFromMessages(messages)
    expect(result.skills).toEqual(['lark-sheets'])
    expect(result.tools).not.toContain('skill')
  })

  it('handles empty messages', () => {
    const result = extractDependenciesFromMessages([])
    expect(result.tools).toEqual([])
    expect(result.skills).toEqual([])
    expect(result.skills).toEqual([])
  })

  it('deduplicates tools', () => {
    const messages: Array<{ role: string; content: ContentBlock[] }> = [
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-1', toolName: 'bash', input: {} },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-2', toolName: 'bash', input: {} },
      ]},
    ]

    const result = extractDependenciesFromMessages(messages)
    expect(result.tools).toEqual(['bash'])
  })

  it('extracts multiple skills', () => {
    const messages: Array<{ role: string; content: ContentBlock[] }> = [
      { role: 'assistant', content: [
        { type: 'tool_result', toolCallId: 'tc-1', toolName: 'skill',
          output: '[SKILL:lark-sheets activated]\n', isError: false },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_result', toolCallId: 'tc-2', toolName: 'skill',
          output: '[SKILL:lark-im activated]\n', isError: false },
      ]},
    ]

    const result = extractDependenciesFromMessages(messages)
    expect(result.skills.sort()).toEqual(['lark-im', 'lark-sheets'])
  })
})
