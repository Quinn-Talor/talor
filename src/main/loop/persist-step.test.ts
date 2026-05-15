// P0-1 配对不变量守门 — 确保 persistStepFromResult 不会留下 orphan tool_use。
//
// 不变量: 每个 assistant.tool-call 必须有对应 tool.tool-result, 否则下次
// streamText 入参校验 → AI_MissingToolResultsError → session 永久污染。

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockCreateBatch, mockCreate, mockTouch } = vi.hoisted(() => ({
  mockCreateBatch: vi.fn(),
  mockCreate: vi.fn(),
  mockTouch: vi.fn(),
}))

vi.mock('../repos/session-repo', () => ({
  messageRepo: { createBatch: mockCreateBatch, create: mockCreate },
  sessionRepo: { touch: mockTouch },
}))

import { persistStepFromResult } from './persist-step'
import type { StepResult, ToolSet } from 'ai'

interface CapturedRecord {
  role: 'assistant' | 'tool'
  content: Array<{
    type: string
    toolCallId?: string
    toolName?: string
    output?: unknown
    isError?: boolean
    text?: string
    input?: unknown
  }>
}

function fakeStep(opts: {
  text?: string
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
  toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>
}): StepResult<ToolSet> {
  return {
    text: opts.text ?? '',
    reasoningText: '',
    toolCalls: opts.toolCalls.map((tc) => ({
      type: 'tool-call',
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    })),
    toolResults: opts.toolResults.map((tr) => ({
      type: 'tool-result',
      toolCallId: tr.toolCallId,
      toolName: tr.toolName,
      output: tr.output,
    })),
  } as unknown as StepResult<ToolSet>
}

describe('persistStepFromResult — tool_use/tool_result 配对守门', () => {
  beforeEach(() => {
    mockCreateBatch.mockReset()
    mockCreate.mockReset()
    mockTouch.mockReset()
  })

  it('正常配对 (4 tool_use + 4 tool_result) → 直接落库', async () => {
    await persistStepFromResult(
      fakeStep({
        text: 'ok',
        toolCalls: [
          { toolCallId: 'a', toolName: 'read', input: {} },
          { toolCallId: 'b', toolName: 'read', input: {} },
        ],
        toolResults: [
          { toolCallId: 'a', toolName: 'read', output: 'r1' },
          { toolCallId: 'b', toolName: 'read', output: 'r2' },
        ],
      }),
      { sessionId: 's1', agentId: 'agent-1' },
    )
    expect(mockCreateBatch).toHaveBeenCalledTimes(1)
    const records = mockCreateBatch.mock.calls[0][0] as CapturedRecord[]
    const toolMsg = records.find((r) => r.role === 'tool')!
    expect(toolMsg.content.length).toBe(2)
  })

  it('partial 配对 (4 tool_use + 1 tool_result) → 自动补 3 个 SDK_TOOL_MISSING_RESULT 占位', async () => {
    await persistStepFromResult(
      fakeStep({
        text: '',
        toolCalls: [
          { toolCallId: 'call_00', toolName: 'mysql_query', input: { sql: 'SELECT 1' } },
          { toolCallId: 'call_01', toolName: 'mysql_query', input: { sql: 'SELECT 2' } },
          { toolCallId: 'call_02', toolName: 'mysql_query', input: { sql: 'SELECT 3' } },
          { toolCallId: 'call_03', toolName: 'mysql_query', input: { sql: 'SELECT 4' } },
        ],
        toolResults: [{ toolCallId: 'call_00', toolName: 'mysql_query', output: 'real result' }],
      }),
      { sessionId: 's1', agentId: 'agent-1' },
    )

    expect(mockCreateBatch).toHaveBeenCalledTimes(1)
    const records = mockCreateBatch.mock.calls[0][0] as CapturedRecord[]
    const toolMsg = records.find((r) => r.role === 'tool')!

    // 不变量: tool-result 数量 === tool-call 数量
    expect(toolMsg.content.length).toBe(4)

    // 真实结果保留
    const real = toolMsg.content.find((p) => p.toolCallId === 'call_00')!
    expect(real.isError).toBeFalsy()

    // 缺失的 3 个被补 SDK_TOOL_MISSING_RESULT 错误占位
    for (const cid of ['call_01', 'call_02', 'call_03']) {
      const placeholder = toolMsg.content.find((p) => p.toolCallId === cid)!
      expect(placeholder.isError).toBe(true)
      const out = placeholder.output as { type: string; value: string }
      expect(out.value).toContain('SDK_TOOL_MISSING_RESULT')
    }
  })

  it('全缺失 (4 tool_use + 0 tool_result) → 补齐 4 个占位, 不留 orphan', async () => {
    await persistStepFromResult(
      fakeStep({
        text: '',
        toolCalls: [
          { toolCallId: 'x1', toolName: 'mysql_query', input: {} },
          { toolCallId: 'x2', toolName: 'mysql_query', input: {} },
          { toolCallId: 'x3', toolName: 'mysql_query', input: {} },
          { toolCallId: 'x4', toolName: 'mysql_query', input: {} },
        ],
        toolResults: [],
      }),
      { sessionId: 's1', agentId: 'agent-1' },
    )

    const records = mockCreateBatch.mock.calls[0][0] as CapturedRecord[]
    const toolMsg = records.find((r) => r.role === 'tool')!
    expect(toolMsg.content.length).toBe(4)
    for (const p of toolMsg.content) {
      expect(p.isError).toBe(true)
      const out = p.output as { type: string; value: string }
      expect(out.value).toContain('SDK_TOOL_MISSING_RESULT')
    }
  })

  it('补齐占位 result 用 toolCalls 里的 toolName (不是占位字符串)', async () => {
    await persistStepFromResult(
      fakeStep({
        toolCalls: [{ toolCallId: 'y1', toolName: 'browser_click', input: {} }],
        toolResults: [],
      }),
      { sessionId: 's1', agentId: 'agent-1' },
    )
    const records = mockCreateBatch.mock.calls[0][0] as CapturedRecord[]
    const toolMsg = records.find((r) => r.role === 'tool')!
    expect(toolMsg.content[0].toolName).toBe('browser_click')
  })

  it('无工具 + 有文本 → 仍走 create (text-only) 路径, 不受守门影响', async () => {
    await persistStepFromResult(fakeStep({ text: 'hello', toolCalls: [], toolResults: [] }), {
      sessionId: 's1',
      agentId: 'agent-1',
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreateBatch).not.toHaveBeenCalled()
  })

  it('无工具 + 无文本 → kind=empty, 不落库', async () => {
    const result = await persistStepFromResult(fakeStep({ toolCalls: [], toolResults: [] }), {
      sessionId: 's1',
      agentId: 'agent-1',
    })
    expect(result.kind).toBe('empty')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCreateBatch).not.toHaveBeenCalled()
  })
})
