import { describe, it, expect } from 'vitest'
import { toolResultPartsToBlocks, buildStreamSignal } from './stream-utils'

describe('toolResultPartsToBlocks', () => {
  it('sets isError=false for successful tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-1',
        toolName: 'read',
        output: { type: 'text' as const, value: 'file content' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(false)
    expect(blocks[0].output).toBe('<tool_output tool="read">\nfile content\n</tool_output>')
  })

  it('sets isError=true for error-text tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-2',
        toolName: 'bash',
        output: { type: 'error-text' as const, value: 'Command not found' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(true)
    expect(blocks[0].output).toContain('Command not found')
    expect(blocks[0].output).toMatch(/^<tool_output tool="bash">/)
  })

  it('marks skill output with trust attribute', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'c',
        toolName: 'skill',
        output: '[SKILL:lark-doc activated]\n...',
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].output).toMatch(/<tool_output tool="skill" trust="skill-content">/)
  })

  it('sets isError=true for error-json tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-3',
        toolName: 'write',
        output: { type: 'error-json' as const, value: { code: 'ACCESS_DENIED' } },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(true)
  })

  it('preserves toolCallId and toolName', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-99',
        toolName: 'glob',
        output: { type: 'text' as const, value: 'results' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].toolCallId).toBe('call-99')
    expect(blocks[0].toolName).toBe('glob')
  })

  it('truncates large output before wrapping', () => {
    const largeValue = 'x'.repeat(200 * 1024)
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-big',
        toolName: 'read',
        output: { type: 'text' as const, value: largeValue },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    // Wrapped length should be less than original + small tag overhead
    expect(blocks[0].output.length).toBeLessThan(largeValue.length + 100)
    expect(blocks[0].output).toContain('truncated')
    expect(blocks[0].output).toMatch(/^<tool_output tool="read">/)
  })

  it.each([
    ['File not found: foo.ts', 'read'],
    ['Path not found: src/x', 'ls'],
    ['[exit: non-zero]\ncommand failed', 'bash'],
    ['Missing required parameter: "path".', 'edit'],
    ['User rejected the tool call', 'write'],
    ['Cannot access path outside workspace', 'read'],
    ['String not found in file: foo', 'edit'],
    ['MCP server "lark" is disconnected. Reconnecting...', 'lark.send_message'],
    ['Tool execution error: timeout', 'lark.send_message'],
  ])('marks builtin/MCP error text "%s" as isError=true', (text, toolName) => {
    const blocks = toolResultPartsToBlocks([
      { toolCallId: 'c', toolName, output: text },
    ])
    expect(blocks[0].isError).toBe(true)
  })

  it('does not mark normal text output as error', () => {
    const blocks = toolResultPartsToBlocks([
      { toolCallId: 'c', toolName: 'read', output: 'hello world' },
    ])
    expect(blocks[0].isError).toBe(false)
  })
})

describe('buildStreamSignal', () => {
  it('返回一个未中止的 AbortSignal', () => {
    const base = new AbortController()
    const signal = buildStreamSignal(base.signal)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('base signal 中止时，组合 signal 也中止', () => {
    const base = new AbortController()
    const signal = buildStreamSignal(base.signal)
    base.abort()
    expect(signal.aborted).toBe(true)
  })
})
