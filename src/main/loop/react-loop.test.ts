// src/main/loop/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn(() => []),
}))

const { mockMessageCreate, mockMessageCreateBatch, mockMessageListBySession, mockSessionTouch, mockStreamText, mockBuildTools } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockMessageCreateBatch: vi.fn(),
  mockMessageListBySession: vi.fn(() => [] as unknown[]),
  mockSessionTouch: vi.fn(),
  mockStreamText: vi.fn(),
  mockBuildTools: vi.fn(),
}))

vi.mock('../repos/session-repo', () => ({
  messageRepo: {
    create: mockMessageCreate,
    createBatch: mockMessageCreateBatch,
    listBySession: mockMessageListBySession,
  },
  sessionRepo: { touch: mockSessionTouch },
}))

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

vi.mock('../tools/build-tools', () => ({
  buildTools: (...args: unknown[]) => mockBuildTools(...args),
}))

import { runReactLoop } from './react-loop'
import { toolResultPartsToBlocks } from './stream-utils'
import type { ReactLoopOptions } from './types'

function makeOpts(overrides: Partial<ReactLoopOptions> = {}): ReactLoopOptions {
  const controller = new AbortController()
  return {
    model: {} as ReactLoopOptions['model'],
    sessionId: 'session-1',
    messageId: 'msg-1',
    userContent: 'hello',
    mappedAttachments: [],
    abortSignal: controller.signal,
    pipeline: {
      build: vi.fn().mockResolvedValue({ messages: [{ role: 'user', content: 'hello' }], tools: [] }),
    } as unknown as ReactLoopOptions['pipeline'],
    provider: { id: 'p1' } as ReactLoopOptions['provider'],
    providerConfig: {} as ReactLoopOptions['providerConfig'],
    workspace: '/tmp',
    callbacks: {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
    },
    maxSteps: 5,
    agent: {
      id: '__chat__',
      toolRegistry: { listTools: () => [], execute: vi.fn() },
    } as unknown as ReactLoopOptions['agent'],
    confirmTool: vi.fn(async () => true),
    ...overrides,
  }
}

describe('runReactLoop — text-only response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
  })

  it('calls onTextDelta with text and persists assistant message', async () => {
    mockStreamText.mockImplementation((params: { onChunk: (arg: { chunk: unknown }) => void }) => {
      params.onChunk({ chunk: { type: 'text-delta', text: 'hello' } })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([]),
      }
    })

    const opts = makeOpts()
    await runReactLoop(opts)

    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('hello')
    expect(mockMessageCreate).toHaveBeenCalled()
    const createCall = mockMessageCreate.mock.calls[0][0]
    expect(createCall.role).toBe('assistant')
  })
})

describe('runReactLoop — abort before loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call onTextDelta or messageRepo.create when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const opts = makeOpts({ abortSignal: controller.signal })
    await runReactLoop(opts)

    expect(opts.callbacks.onTextDelta).not.toHaveBeenCalled()
    expect(mockMessageCreate).not.toHaveBeenCalled()
  })
})

describe('runReactLoop — context budget guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
  })

  it('prompt 超 98% 但未到 100% 时在 messages 末尾注入 [CONTEXT NEARLY FULL]', async () => {
    // estimate('x'*197) = ceil(197*0.25) = 50 tokens。设 limit=51 → 50/51≈98.04%,
    // > 0.98 触发软告警; < 1.0 不触发硬阻断。
    const bigText = 'x'.repeat(197)
    const capturedMessages: unknown[][] = []
    mockStreamText.mockImplementation((params: { messages: unknown[]; onChunk?: (arg: { chunk: unknown }) => void }) => {
      capturedMessages.push(params.messages)
      params.onChunk?.({ chunk: { type: 'text-delta', text: 'ok' } })
      return { consumeStream: vi.fn().mockResolvedValue(undefined), toolResults: Promise.resolve([]) }
    })

    const opts = makeOpts({
      maxSteps: 1,
      providerConfig: { context_limit: 51, recent_ratio: 0.05, summary_ratio: 0.05 } as ReactLoopOptions['providerConfig'],
      pipeline: {
        build: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: bigText }],
          tools: [],
        }),
      } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const sent = capturedMessages[0] as Array<{ role: string; content: string }>
    const tail = sent[sent.length - 1]
    expect(tail.role).toBe('system')
    expect(tail.content).toMatch(/^\[CONTEXT NEARLY FULL\]/)
    // 文案不应含"不许开工具链"等过激命令
    expect(tail.content).not.toMatch(/Do not start new tool chains/)
  })

  it('prompt 估算 >= 100% context_limit 时硬阻断:不调 streamText, 写 [auto-halt]', async () => {
    // estimate('x'*1000) ≈ 250 tokens >= 50 → 超限
    const bigText = 'x'.repeat(1000)
    const opts = makeOpts({
      maxSteps: 3,
      providerConfig: { context_limit: 50, recent_ratio: 0.05, summary_ratio: 0.05 } as ReactLoopOptions['providerConfig'],
      pipeline: {
        build: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: bigText }],
          tools: [],
        }),
      } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    // 关键:streamText 不应被调用,prompt 在提交前被拦住。
    expect(mockStreamText).not.toHaveBeenCalled()
    // halt 消息写入 DB + 回调给 UI
    expect(mockMessageCreate).toHaveBeenCalled()
    const createCall = mockMessageCreate.mock.calls[0][0]
    expect(createCall.role).toBe('assistant')
    expect(createCall.content[0].text).toMatch(/^\[auto-halt\]/)
    expect(createCall.content[0].text).toMatch(/Context window exceeded/)
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith(expect.stringMatching(/^\[auto-halt\]/))
  })

  it('prompt 低于 98% 时不注入预警', async () => {
    const capturedMessages: unknown[][] = []
    mockStreamText.mockImplementation((params: { messages: unknown[]; onChunk?: (arg: { chunk: unknown }) => void }) => {
      capturedMessages.push(params.messages)
      params.onChunk?.({ chunk: { type: 'text-delta', text: 'ok' } })
      return { consumeStream: vi.fn().mockResolvedValue(undefined), toolResults: Promise.resolve([]) }
    })

    const opts = makeOpts({
      maxSteps: 1,
      providerConfig: { context_limit: 100000, recent_ratio: 0.05, summary_ratio: 0.05 } as ReactLoopOptions['providerConfig'],
      pipeline: {
        build: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
        }),
      } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const sent = capturedMessages[0] as Array<{ role: string; content: string }>
    expect(sent.some(m => typeof m.content === 'string' && m.content.startsWith('[CONTEXT NEARLY FULL]'))).toBe(false)
  })
})

describe('runReactLoop — dead-loop detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: false,
      })),
    )
  })

  function agent(names: string[] = ['bash']): ReactLoopOptions['agent'] {
    return {
      id: '__chat__',
      toolRegistry: { listTools: () => [], getToolNames: () => names },
    } as unknown as ReactLoopOptions['agent']
  }

  it('带 error 的同签名第 2 次即 break (阈值 1)', async () => {
    // 让 toolResultPartsToBlocks 把结果标记为 isError=true
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: true,
      })),
    )

    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void }) => {
      if (params.onChunk) {
        params.onChunk({ chunk: { type: 'tool-call', toolCallId: 'tc', toolName: 'bash', input: { cmd: 'ls' } } })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([{ toolCallId: 'tc', toolName: 'bash', output: 'same error' }]),
        }
      }
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        textStream: (async function* () { yield '' })(),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // isError=true + 同签名 → 第 2 步就 break;主循环 streamText 被调 2 次
    const toolCalls = mockStreamText.mock.calls.filter(c => (c[0] as { onChunk?: unknown })?.onChunk).length
    expect(toolCalls).toBe(2)
  })

  it('不带 error 的同签名需到第 3 次才 break (阈值 2)', async () => {
    // isError=false → 阈值 2 → 允许第 2 次同签名(可能是合理的幂等读)
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: false,
      })),
    )

    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void }) => {
      if (params.onChunk) {
        params.onChunk({ chunk: { type: 'tool-call', toolCallId: 'tc', toolName: 'read', input: { path: 'a.txt' } } })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([{ toolCallId: 'tc', toolName: 'read', output: 'same content' }]),
        }
      }
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        textStream: (async function* () { yield '' })(),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent(['read']) })
    await runReactLoop(opts)

    // isError=false → 阈值 2 → 第 3 步 break
    const toolCalls = mockStreamText.mock.calls.filter(c => (c[0] as { onChunk?: unknown })?.onChunk).length
    expect(toolCalls).toBe(3)
  })

  it('连续 3 步全部失败才 break (任一步成功即清零)', async () => {
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: true,
      })),
    )

    let stepIdx = 0
    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void }) => {
      if (!params.onChunk) {
        return { consumeStream: vi.fn().mockResolvedValue(undefined), textStream: (async function* () { yield '' })() }
      }
      stepIdx++
      params.onChunk({
        chunk: { type: 'tool-call', toolCallId: `tc${stepIdx}`, toolName: 'bash', input: { cmd: `cmd${stepIdx}` } },
      })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([{ toolCallId: `tc${stepIdx}`, toolName: 'bash', output: `err${stepIdx}` }]),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // 连续 3 步全失败 → break。每步签名都不同,触发的是连续失败而非签名判定。
    const toolCalls = mockStreamText.mock.calls.filter(c => (c[0] as { onChunk?: unknown })?.onChunk).length
    expect(toolCalls).toBe(3)
    const haltCall = mockMessageCreate.mock.calls.find(
      (c) => Array.isArray(c[0].content) && c[0].content[0]?.text?.includes('[auto-halt]'),
    )
    expect(haltCall).toBeDefined()
  })

  it('同命令但字段顺序不同时 signature 相同,触发重复侦测', async () => {
    // 模型调用 1: {command: "ls", description: "note"}
    // 模型调用 2: {description: "note", command: "ls"}   (仅字段顺序变化)
    // canonical 化后 inputHash 相同,应触发阈值 1 的签名重复 break
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: true,
      })),
    )

    let stepIdx = 0
    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void }) => {
      if (!params.onChunk) {
        return { consumeStream: vi.fn().mockResolvedValue(undefined), textStream: (async function* () { yield '' })() }
      }
      stepIdx++
      const input = stepIdx === 1
        ? { command: 'ls', description: 'note' }
        : { description: 'note', command: 'ls' }
      params.onChunk({
        chunk: { type: 'tool-call', toolCallId: `tc${stepIdx}`, toolName: 'bash', input },
      })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([{
          toolCallId: `tc${stepIdx}`,
          toolName: 'bash',
          output: '[Raw output]\nsame error',
        }]),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // signature 重复 (isError) 阈值 1 → 第 2 步就 break
    const toolCalls = mockStreamText.mock.calls.filter(c => (c[0] as { onChunk?: unknown })?.onChunk).length
    expect(toolCalls).toBe(2)
  })

  it('outputHash 跳过指引前缀: 指引相同但 raw 不同,signature 不应相同', async () => {
    // 两步的 output 前缀都是相同的指引,raw 不同。旧逻辑会把前 500 字节视为
    // 指引文本 → hash 相同;新逻辑跳到 [Raw output] 之后,能区分不同的 raw。
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: false,
      })),
    )

    const GUIDE_PREFIX = '[How to interpret this result]\n\n' + 'x'.repeat(1000) + '\n\n---\n\n'
    let stepIdx = 0
    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void }) => {
      if (!params.onChunk) {
        return { consumeStream: vi.fn().mockResolvedValue(undefined), textStream: (async function* () { yield '' })() }
      }
      stepIdx++
      // 两次同 input,但 output 的 raw 段不同——signature 应当不同
      params.onChunk({
        chunk: { type: 'tool-call', toolCallId: `tc${stepIdx}`, toolName: 'read', input: { path: '/x' } },
      })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([{
          toolCallId: `tc${stepIdx}`,
          toolName: 'read',
          output: GUIDE_PREFIX + '[Raw output]\nraw-content-' + stepIdx,
        }]),
      }
    })

    const opts = makeOpts({ maxSteps: 3, agent: agent(['read']) })
    await runReactLoop(opts)

    // isError=false 的同 input 连续:阈值 2,第 3 步才 break。若 outputHash 失效
    // (旧逻辑) 会把两次 output 视为相同 → 阈值被快速触发。新逻辑下两次 output
    // 的 raw 不同 → signature 不同 → 至少跑 3 步不 break。
    const toolCalls = mockStreamText.mock.calls.filter(c => (c[0] as { onChunk?: unknown })?.onChunk).length
    expect(toolCalls).toBe(3)  // maxSteps 耗尽或 no_tool_calls,不是 repeated_error 触发
  })

  it('失败→成功→失败→失败 不触发 break (中间成功清零计数)', async () => {
    // step1: fail, step2: success, step3: fail, step4: fail → 连续失败最多 2 步,
    // 不触发阈值 3。
    const patterns: boolean[] = [true, false, true, true]
    let stepIdx = 0
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: patterns[stepIdx - 1] ?? false,
      })),
    )

    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void }) => {
      if (!params.onChunk) {
        return { consumeStream: vi.fn().mockResolvedValue(undefined), textStream: (async function* () { yield '' })() }
      }
      stepIdx++
      params.onChunk({
        chunk: { type: 'tool-call', toolCallId: `tc${stepIdx}`, toolName: 'bash', input: { cmd: `cmd${stepIdx}` } },
      })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([{ toolCallId: `tc${stepIdx}`, toolName: 'bash', output: `out${stepIdx}` }]),
      }
    })

    const opts = makeOpts({ maxSteps: 4, agent: agent() })
    await runReactLoop(opts)

    // 连续失败最多 2 步(step3/step4,中间 step2 成功清零),不足阈值 3 → 不 halt
    const haltCall = mockMessageCreate.mock.calls.find(
      (c) => Array.isArray(c[0].content) && c[0].content[0]?.text?.includes('[auto-halt]'),
    )
    expect(haltCall).toBeUndefined()
  })
})

describe('runReactLoop — fallback summary quote verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
    mockMessageListBySession.mockReturnValue([])
  })

  /**
   * 构造触发 fallback 的场景:第 1 步有 tool-call,toolResults 为空 → SDK 把它替换为
   * 错误消息继续循环;第 2 步无工具、无文本 → 本轮 fullText=0 → 触发 runFallbackSummary。
   * fallback 又做一次 streamText(不带 tools)产出摘要文本。
   */
  function setupFallbackScenarioWithSummary(summaryText: string) {
    let call = 0
    mockStreamText.mockImplementation((params: { onChunk?: (arg: { chunk: unknown }) => void; messages?: unknown[] }) => {
      call++
      if (call === 1) {
        // 第 1 步:触发 tool-call 但 toolResults 返回空 → 走 disambiguation 分支
        params.onChunk?.({ chunk: { type: 'tool-call', toolCallId: 'tc1', toolName: 'read', input: { path: '/a' } } })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([]),
        }
      }
      if (call === 2) {
        // 第 2 步:无工具、无文本 → 触发兜底
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([]),
        }
      }
      // 第 3 次 streamText = runFallbackSummary 内部调用:产出摘要
      // 兜底分支用 `for await (const chunk of result.textStream)` 消费
      return {
        textStream: (async function* () { yield summaryText })(),
      }
    })
  }

  it('fallback 摘要里未命中 tool_output 的长引用被替换为 ⟨unverifiable⟩', async () => {
    const realToolText = 'File written: /tmp/report.txt (120 bytes)'
    // DB 里最近一条 tool 消息的 content 是 JSON blocks
    mockMessageListBySession.mockReturnValue([
      {
        id: 'm1', session_id: 's1', role: 'tool', agent_id: '__chat__', created_at: 'x',
        content: JSON.stringify([{ type: 'tool_result', output: realToolText, toolCallId: 'tc1', toolName: 'read' }]),
      },
    ])

    const fabricatedSummary =
      'Summary: "all 42 records inserted successfully into the database without error"'
    setupFallbackScenarioWithSummary(fabricatedSummary)

    const opts = makeOpts({ maxSteps: 2, agent: {
      id: '__chat__',
      toolRegistry: { listTools: () => [], getToolNames: () => ['read'] },
    } as unknown as ReactLoopOptions['agent'] })
    await runReactLoop(opts)

    // 找到落库的兜底摘要消息
    const summaryCall = mockMessageCreate.mock.calls.find(
      (c) => Array.isArray(c[0].content) && typeof c[0].content[0]?.text === 'string' && c[0].content[0].text.startsWith('[auto-summary')
    )
    expect(summaryCall).toBeDefined()
    const text = summaryCall![0].content[0].text as string
    expect(text).toMatch(/^\[auto-summary • 1 unverifiable quote masked\]/)
    expect(text).toContain('⟨unverifiable⟩')
    expect(text).not.toContain('42 records inserted')
  })

  it('fallback 摘要里命中真实 tool_output 的长引用不被替换', async () => {
    const realToolText = 'The server responded with "authentication token expired, please login again"'
    mockMessageListBySession.mockReturnValue([
      {
        id: 'm1', session_id: 's1', role: 'tool', agent_id: '__chat__', created_at: 'x',
        content: JSON.stringify([{ type: 'tool_result', output: realToolText, toolCallId: 'tc1', toolName: 'bash' }]),
      },
    ])

    const summary = 'Result: "authentication token expired, please login again"'
    setupFallbackScenarioWithSummary(summary)

    const opts = makeOpts({ maxSteps: 2, agent: {
      id: '__chat__',
      toolRegistry: { listTools: () => [], getToolNames: () => ['bash'] },
    } as unknown as ReactLoopOptions['agent'] })
    await runReactLoop(opts)

    const summaryCall = mockMessageCreate.mock.calls.find(
      (c) => Array.isArray(c[0].content) && typeof c[0].content[0]?.text === 'string' && c[0].content[0].text.startsWith('[auto-summary')
    )
    expect(summaryCall).toBeDefined()
    const text = summaryCall![0].content[0].text as string
    // 未命中 → 标签无 "unverifiable" 计数
    expect(text).toMatch(/^\[auto-summary\]/)
    expect(text).not.toContain('⟨unverifiable⟩')
    expect(text).toContain('authentication token expired')
  })
})

describe('runReactLoop — empty toolResults disambiguation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
  })

  /**
   * Step 1 emits a tool-call with empty toolResults (the disambiguation branch
   * under test); step 2 emits final text so the loop exits cleanly without
   * triggering the fallback summary path.
   */
  function setupToolCallThenFinalText(toolName: string) {
    let call = 0
    mockStreamText.mockImplementation((params: { onChunk: (arg: { chunk: unknown }) => void }) => {
      call++
      if (call === 1) {
        params.onChunk({ chunk: { type: 'tool-call', toolCallId: 'tc1', toolName, input: { x: 1 } } })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([]),
        }
      }
      params.onChunk({ chunk: { type: 'text-delta', text: 'done' } })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([]),
      }
    })
  }

  function agentWithRegistered(names: string[]): ReactLoopOptions['agent'] {
    return {
      id: '__chat__',
      toolRegistry: { listTools: () => [], getToolNames: () => names },
    } as unknown as ReactLoopOptions['agent']
  }

  function captureToolResultBlocks() {
    const mocked = vi.mocked(toolResultPartsToBlocks)
    mocked.mockImplementation((parts) =>
      parts.map(p => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: String(p.output).startsWith('Tool execution failed:') || String(p.output).startsWith('Tool not found:'),
      })),
    )
    return mocked
  }

  it('unknown tool name: injects "Tool not found" + available list', async () => {
    setupToolCallThenFinalText('nonexistent_tool')
    const mocked = captureToolResultBlocks()

    const opts = makeOpts({
      maxSteps: 3,
      agent: agentWithRegistered(['bash', 'read', 'write']),
    })
    await runReactLoop(opts)

    const parts = mocked.mock.calls[0][0] as Array<{ output: unknown }>
    expect(String(parts[0].output)).toMatch(/^Tool not found: "nonexistent_tool"/)
    expect(String(parts[0].output)).toContain('bash, read, write')
  })

  it('known tool name but empty result: injects "execution failed, do NOT retry"', async () => {
    setupToolCallThenFinalText('bash')
    const mocked = captureToolResultBlocks()

    const opts = makeOpts({
      maxSteps: 3,
      agent: agentWithRegistered(['bash', 'read', 'write']),
    })
    await runReactLoop(opts)

    const parts = mocked.mock.calls[0][0] as Array<{ output: unknown }>
    expect(String(parts[0].output)).toMatch(/^Tool execution failed: "bash"/)
    expect(String(parts[0].output)).toMatch(/unlikely to help/)
    expect(String(parts[0].output)).not.toMatch(/Tool not found/)
  })
})
