import { describe, it, expect, vi, afterEach } from 'vitest'
import { toolResultPartsToBlocks, buildStreamSignal, buildStreamTimeout } from './stream-utils'

describe('toolResultPartsToBlocks', () => {
  it('sets isError=false for successful tool result and stores raw (no guide in DB)', () => {
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
    // DB 只存 raw:`<tool_output tool="read">\n<raw>\n</tool_output>`,不带指引
    expect(blocks[0].output).toBe('<tool_output tool="read">\nfile content\n</tool_output>')
    // 确保不含指引关键词(指引在 LLM 注入时才动态拼接)
    expect(blocks[0].output).not.toContain('[How to interpret this result]')
    expect(blocks[0].output).not.toContain('[Raw output]')
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
    const blocks = toolResultPartsToBlocks([{ toolCallId: 'c', toolName, output: text }])
    expect(blocks[0].isError).toBe(true)
  })

  it('does not mark normal text output as error', () => {
    const blocks = toolResultPartsToBlocks([
      { toolCallId: 'c', toolName: 'read', output: 'hello world' },
    ])
    expect(blocks[0].isError).toBe(false)
  })

  it('marks ToolErrorEnvelope as isError=true and renders [CODE] message', () => {
    const envelope = {
      __talor_error: true as const,
      code: 'MCP_TIMEOUT',
      message: 'Tool execution timed out',
      hint: 'Check network latency.',
    }
    const blocks = toolResultPartsToBlocks([
      { toolCallId: 'c', toolName: 'lark.send', output: envelope },
    ])
    expect(blocks[0].isError).toBe(true)
    expect(blocks[0].output).toContain('[MCP_TIMEOUT]')
    expect(blocks[0].output).toContain('Tool execution timed out')
    expect(blocks[0].output).toContain('hint: Check network latency.')
  })

  it('renders envelope without hint when hint absent', () => {
    const envelope = {
      __talor_error: true as const,
      code: 'MCP_EXCEPTION',
      message: 'connection refused',
    }
    const blocks = toolResultPartsToBlocks([{ toolCallId: 'c', toolName: 'mcp', output: envelope }])
    expect(blocks[0].output).toContain('[MCP_EXCEPTION] connection refused')
    expect(blocks[0].output).not.toContain('hint:')
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

describe('buildStreamTimeout (不活跃超时 + 工具期暂停)', () => {
  afterEach(() => vi.useRealTimers())

  it('不活跃超过 timeoutMs → 以 TimeoutError abort', () => {
    vi.useFakeTimers()
    const base = new AbortController()
    const t = buildStreamTimeout(base.signal, 1000)
    expect(t.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(t.signal.aborted).toBe(true)
    expect((t.signal.reason as Error)?.name).toBe('TimeoutError')
  })

  it('工具执行期 pause → 即使超过 timeoutMs 也不 abort;resume 后才重新计时', () => {
    vi.useFakeTimers()
    const base = new AbortController()
    const t = buildStreamTimeout(base.signal, 1000)
    t.pause() // 工具开始
    vi.advanceTimersByTime(5000) // 工具跑很久
    expect(t.signal.aborted).toBe(false) // 不计入流超时
    t.resume() // 工具结束
    vi.advanceTimersByTime(999)
    expect(t.signal.aborted).toBe(false)
    vi.advanceTimersByTime(2)
    expect(t.signal.aborted).toBe(true) // 恢复后才触发
  })

  it('并行工具:计数归零后才恢复计时', () => {
    vi.useFakeTimers()
    const t = buildStreamTimeout(new AbortController().signal, 1000)
    t.pause()
    t.pause() // 两个并行工具
    t.resume() // 一个结束
    vi.advanceTimersByTime(2000)
    expect(t.signal.aborted).toBe(false) // 仍有工具在跑,不超时
    t.resume() // 全部结束
    vi.advanceTimersByTime(1001)
    expect(t.signal.aborted).toBe(true)
  })

  it('ping 重置计时(模型持续产出不超时)', () => {
    vi.useFakeTimers()
    const t = buildStreamTimeout(new AbortController().signal, 1000)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(800)
      t.ping() // 每 800ms 来一个 chunk
    }
    expect(t.signal.aborted).toBe(false) // 持续活跃,不超时
    vi.advanceTimersByTime(1001)
    expect(t.signal.aborted).toBe(true) // 停止产出后超时
  })

  it('父 abort 仍生效;dispose 后不再触发', () => {
    vi.useFakeTimers()
    const base = new AbortController()
    const t = buildStreamTimeout(base.signal, 1000)
    base.abort()
    expect(t.signal.aborted).toBe(true)

    const t2 = buildStreamTimeout(new AbortController().signal, 1000)
    t2.dispose()
    vi.advanceTimersByTime(2000)
    expect(t2.signal.aborted).toBe(false) // 已清理,不会超时
  })
})
