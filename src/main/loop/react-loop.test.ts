// src/main/loop/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn(() => []),
  extractOutputText: vi.fn((output: unknown) =>
    typeof output === 'string' ? output : JSON.stringify(output ?? ''),
  ),
  isErrorOutput: vi.fn((output: unknown) => {
    if (typeof output === 'object' && output !== null) {
      if ((output as Record<string, unknown>).__talor_error === true) return true
    }
    const s = String(output ?? '')
    return (
      s.startsWith('Tool execution failed:') ||
      s.startsWith('Tool not found:') ||
      s.startsWith('Error')
    )
  }),
  truncateOutput: vi.fn((s: string) => s),
  wrapToolOutput: vi.fn((_name: string, body: string) => body),
}))

const {
  mockMessageCreate,
  mockMessageCreateBatch,
  mockMessageListBySession,
  mockSessionTouch,
  mockStreamText,
  mockBuildTools,
} = vi.hoisted(() => ({
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

/**
 * Simulate AI SDK v6 tool lifecycle: experimental_onToolCallStart + Finish.
 * Replaces the older params.onChunk({chunk: {type: 'tool-call'}}) pattern that
 * stopped working when react-loop migrated tool wiring off onChunk to fix the
 * spinner-flash-1ms bug.
 */
type StreamTextParams = {
  onChunk?: (arg: { chunk: unknown }) => void
  experimental_onToolCallStart?: (event: {
    toolCall: { toolCallId: string; toolName: string; input: unknown }
  }) => void
  experimental_onToolCallFinish?: (
    event:
      | {
          toolCall: { toolCallId: string; toolName: string; input: unknown }
          durationMs: number
          success: true
          output: unknown
        }
      | {
          toolCall: { toolCallId: string; toolName: string; input: unknown }
          durationMs: number
          success: false
          error: unknown
        },
  ) => void
}

function fireToolCall(
  params: StreamTextParams,
  toolCallId: string,
  toolName: string,
  input: unknown,
  output: unknown = '',
  success = true,
): void {
  const toolCall = { toolCallId, toolName, input }
  params.experimental_onToolCallStart?.({ toolCall })
  if (success) {
    params.experimental_onToolCallFinish?.({ toolCall, durationMs: 1, success: true, output })
  } else {
    params.experimental_onToolCallFinish?.({
      toolCall,
      durationMs: 1,
      success: false,
      error: output,
    })
  }
}

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
      build: vi
        .fn()
        .mockResolvedValue({ messages: [{ role: 'user', content: 'hello' }], tools: [] }),
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
  } as unknown as ReactLoopOptions
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

    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('hello', expect.any(Number))
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
    mockStreamText.mockImplementation(
      (params: { messages: unknown[]; onChunk?: (arg: { chunk: unknown }) => void }) => {
        capturedMessages.push(params.messages)
        params.onChunk?.({ chunk: { type: 'text-delta', text: 'ok' } })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([]),
        }
      },
    )

    const opts = makeOpts({
      maxSteps: 1,
      providerConfig: {
        context_limit: 51,
        recent_ratio: 0.05,
        summary_ratio: 0.05,
      } as ReactLoopOptions['providerConfig'],
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
      providerConfig: {
        context_limit: 50,
        recent_ratio: 0.05,
        summary_ratio: 0.05,
      } as ReactLoopOptions['providerConfig'],
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
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith(
      expect.stringMatching(/^\[auto-halt\]/),
      expect.any(Number),
    )
  })

  it('prompt 低于 98% 时不注入预警', async () => {
    const capturedMessages: unknown[][] = []
    mockStreamText.mockImplementation(
      (params: { messages: unknown[]; onChunk?: (arg: { chunk: unknown }) => void }) => {
        capturedMessages.push(params.messages)
        params.onChunk?.({ chunk: { type: 'text-delta', text: 'ok' } })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([]),
        }
      },
    )

    const opts = makeOpts({
      maxSteps: 1,
      providerConfig: {
        context_limit: 100000,
        recent_ratio: 0.05,
        summary_ratio: 0.05,
      } as ReactLoopOptions['providerConfig'],
      pipeline: {
        build: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
        }),
      } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const sent = capturedMessages[0] as Array<{ role: string; content: string }>
    expect(
      sent.some(
        (m) => typeof m.content === 'string' && m.content.startsWith('[CONTEXT NEARLY FULL]'),
      ),
    ).toBe(false)
  })
})

describe('runReactLoop — dead-loop detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map((p) => ({
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
      toolRegistry: {
        listTools: () => [],
        getToolNames: () => names,
        listMcpTools: () => [],
      },
    } as unknown as ReactLoopOptions['agent']
  }

  it('带 error 的同签名第 2 次即 break (阈值 1)', async () => {
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      if (params.onChunk) {
        fireToolCall(params, 'tc', 'bash', { cmd: 'ls' }, 'Error: same error')
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([
            { toolCallId: 'tc', toolName: 'bash', output: 'Error: same error' },
          ]),
        }
      }
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        textStream: (async function* () {
          yield ''
        })(),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // isError=true + 同签名 → 第 2 步就 break;主循环 streamText 被调 2 次
    const toolCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(toolCalls).toBe(2)
  })

  it('不带 error 的同签名需到第 3 次才 break (阈值 2)', async () => {
    // isError=false → 阈值 2 → 允许第 2 次同签名(可能是合理的幂等读)
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map((p) => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: false,
      })),
    )

    mockStreamText.mockImplementation((params: StreamTextParams) => {
      if (params.onChunk) {
        fireToolCall(params, 'tc', 'read', { path: 'a.txt' }, 'same content')
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([
            { toolCallId: 'tc', toolName: 'read', output: 'same content' },
          ]),
        }
      }
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        textStream: (async function* () {
          yield ''
        })(),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent(['read']) })
    await runReactLoop(opts)

    // isError=false → 阈值 2 → 第 3 步 break
    const toolCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(toolCalls).toBe(3)
  })

  it('连续 3 步全部失败 → 进入 failure-recovery 摘要而非冷halt', async () => {
    let stepIdx = 0
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      if (!params.onChunk) {
        // runFailureStreakSummary 调用：返回 streaming text（mock 解释文本）
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          textStream: (async function* () {
            yield 'I tried bash 3 times and all failed: err1, err2, err3.'
          })(),
        }
      }
      stepIdx++
      fireToolCall(params, `tc${stepIdx}`, 'bash', { cmd: `cmd${stepIdx}` }, `Error: err${stepIdx}`)
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([
          { toolCallId: `tc${stepIdx}`, toolName: 'bash', output: `Error: err${stepIdx}` },
        ]),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    const toolCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(toolCalls).toBe(3)
    // 不再写 [auto-halt]，而是 [failure-recovery] 摘要
    const recoveryCall = mockMessageCreate.mock.calls.find(
      (c) =>
        Array.isArray(c[0].content) &&
        typeof c[0].content[0]?.text === 'string' &&
        c[0].content[0].text.startsWith('[failure-recovery'),
    )
    expect(recoveryCall).toBeDefined()
    // 摘要文本来自模型（这里是 mock 的解释文本）
    expect(recoveryCall?.[0].content[0].text).toContain('err')
    // 旧的冷halt 文案不应出现
    const haltCall = mockMessageCreate.mock.calls.find(
      (c) =>
        Array.isArray(c[0].content) &&
        typeof c[0].content[0]?.text === 'string' &&
        c[0].content[0].text.includes('[auto-halt]'),
    )
    expect(haltCall).toBeUndefined()
  })

  it('streak=2 时注入 failure-streak hint 给模型自我修正机会', async () => {
    let stepIdx = 0
    // 每步快照"是否含 failure-streak hint"——直接在 capture 时计算，避免共享数组引用陷阱
    const hintPresentPerStep: boolean[] = []
    // 让 pipeline.build 每次返回新 array（避免 react-loop push hint 反向污染早期快照）
    const opts = makeOpts({
      maxSteps: 10,
      agent: agent(),
      pipeline: {
        build: vi.fn(async () => ({
          messages: [{ role: 'user', content: 'hello' }],
          tools: [],
        })),
      } as unknown as ReactLoopOptions['pipeline'],
    })

    mockStreamText.mockImplementation(
      (params: StreamTextParams & { messages?: Array<{ role: string; content: unknown }> }) => {
        if (!params.onChunk) {
          return {
            consumeStream: vi.fn().mockResolvedValue(undefined),
            textStream: (async function* () {
              yield 'recovered'
            })(),
          }
        }
        stepIdx++
        const hasHint = (params.messages ?? []).some(
          (m) =>
            m.role === 'system' &&
            typeof m.content === 'string' &&
            m.content.includes('failure-streak warning'),
        )
        hintPresentPerStep.push(hasHint)
        fireToolCall(
          params,
          `tc${stepIdx}`,
          'bash',
          { cmd: `cmd${stepIdx}` },
          `Error: err${stepIdx}`,
        )
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([
            { toolCallId: `tc${stepIdx}`, toolName: 'bash', output: `Error: err${stepIdx}` },
          ]),
        }
      },
    )

    await runReactLoop(opts)

    // step 0: streak=0, 无 hint
    // step 1: streak=1, 无 hint
    // step 2: streak=2, 有 hint（即将 break，最后修正机会）
    expect(hintPresentPerStep).toEqual([false, false, true])
  })

  it('E1: SUBAGENT_* envelope 加权 +2,2 步达到 streak 阈值即触发 failure-recovery', async () => {
    let stepIdx = 0
    let summaryStarted = false
    mockStreamText.mockImplementation((params: StreamTextParams & { messages?: unknown[] }) => {
      if (!params.onChunk) {
        // failure-streak summary 路径（无 onChunk）
        summaryStarted = true
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          textStream: (async function* () {
            yield 'sub-failed'
          })(),
        }
      }
      stepIdx++
      const subagentEnvelope = {
        __talor_error: true,
        code: 'SUBAGENT_RECOVERY',
        message: `subagent recovery on step ${stepIdx}`,
        hint: 'inspect logs',
      }
      fireToolCall(
        params,
        `tc${stepIdx}`,
        'delegate_agent',
        { agent_id: 'x', instruction: 'go' },
        subagentEnvelope,
      )
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([
          { toolCallId: `tc${stepIdx}`, toolName: 'delegate_agent', output: subagentEnvelope },
        ]),
      }
    })
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // E1 weight=2: 步 1 streak=2, 步 2 streak=4 >= 3 → 触发 failure-streak summary
    // 不带 E1 加权时,需要 3 步才到 streak=3
    expect(stepIdx).toBe(2)
    expect(summaryStarted).toBe(true)
  })

  it('E1: 普通 tool 错误仍按 +1 计数,需要 3 步才触发', async () => {
    let stepIdx = 0
    let summaryStarted = false
    mockStreamText.mockImplementation((params: StreamTextParams & { messages?: unknown[] }) => {
      if (!params.onChunk) {
        summaryStarted = true
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          textStream: (async function* () {
            yield 'recovered'
          })(),
        }
      }
      stepIdx++
      fireToolCall(params, `tc${stepIdx}`, 'bash', { cmd: `cmd${stepIdx}` }, `Error: err${stepIdx}`)
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([
          { toolCallId: `tc${stepIdx}`, toolName: 'bash', output: `Error: err${stepIdx}` },
        ]),
      }
    })
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // streak=1, 2, 3 → 第 3 步触发
    expect(stepIdx).toBe(3)
    expect(summaryStarted).toBe(true)
  })

  it('同命令但字段顺序不同时 signature 相同,触发重复侦测', async () => {
    let stepIdx = 0
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      if (!params.onChunk) {
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          textStream: (async function* () {
            yield ''
          })(),
        }
      }
      stepIdx++
      const input =
        stepIdx === 1
          ? { command: 'ls', description: 'note' }
          : { description: 'note', command: 'ls' }
      fireToolCall(params, `tc${stepIdx}`, 'bash', input, 'Error: same error')
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([
          {
            toolCallId: `tc${stepIdx}`,
            toolName: 'bash',
            output: 'Error: same error',
          },
        ]),
      }
    })

    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // signature 重复 (isError) 阈值 1 → 第 2 步就 break
    const toolCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(toolCalls).toBe(2)
  })

  it('outputHash 跳过指引前缀: 指引相同但 raw 不同,signature 不应相同', async () => {
    // 两步的 output 前缀都是相同的指引,raw 不同。旧逻辑会把前 500 字节视为
    // 指引文本 → hash 相同;新逻辑跳到 [Raw output] 之后,能区分不同的 raw。
    const GUIDE_PREFIX = '[How to interpret this result]\n\n' + 'x'.repeat(1000) + '\n\n---\n\n'
    let stepIdx = 0
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      if (!params.onChunk) {
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          textStream: (async function* () {
            yield ''
          })(),
        }
      }
      stepIdx++
      // 两次同 input,但 output 的 raw 段不同——signature 应当不同
      const output = GUIDE_PREFIX + '[Raw output]\nraw-content-' + stepIdx
      fireToolCall(params, `tc${stepIdx}`, 'read', { path: '/x' }, output)
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([
          {
            toolCallId: `tc${stepIdx}`,
            toolName: 'read',
            output,
          },
        ]),
      }
    })

    const opts = makeOpts({ maxSteps: 3, agent: agent(['read']) })
    await runReactLoop(opts)

    // isError=false 的同 input 连续:阈值 2,第 3 步才 break。若 outputHash 失效
    // (旧逻辑) 会把两次 output 视为相同 → 阈值被快速触发。新逻辑下两次 output
    // 的 raw 不同 → signature 不同 → 至少跑 3 步不 break。
    const toolCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(toolCalls).toBe(3) // maxSteps 耗尽或 no_tool_calls,不是 repeated_error 触发
  })

  it('失败→成功→失败→失败 不触发 break (中间成功清零计数)', async () => {
    // step1: fail, step2: success, step3: fail, step4: fail → 连续失败最多 2 步,
    // 不触发阈值 3。
    const patterns: boolean[] = [true, false, true, true]
    let stepIdx = 0
    vi.mocked(toolResultPartsToBlocks).mockImplementation((parts) =>
      parts.map((p) => ({
        type: 'tool_result' as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: String(p.output),
        isError: patterns[stepIdx - 1] ?? false,
      })),
    )

    mockStreamText.mockImplementation((params: StreamTextParams) => {
      if (!params.onChunk) {
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          textStream: (async function* () {
            yield ''
          })(),
        }
      }
      stepIdx++
      fireToolCall(params, `tc${stepIdx}`, 'bash', { cmd: `cmd${stepIdx}` }, `out${stepIdx}`)
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([
          { toolCallId: `tc${stepIdx}`, toolName: 'bash', output: `out${stepIdx}` },
        ]),
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
    mockStreamText.mockImplementation((params: StreamTextParams & { messages?: unknown[] }) => {
      call++
      if (call === 1) {
        // 第 1 步:触发 tool-call 但 toolResults 返回空 → 走 disambiguation 分支
        fireToolCall(params, 'tc1', 'read', { path: '/a' })
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
        textStream: (async function* () {
          yield summaryText
        })(),
      }
    })
  }

  it('fallback 摘要里未命中 tool_output 的长引用被替换为 ⟨unverifiable⟩', async () => {
    const realToolText = 'File written: /tmp/report.txt (120 bytes)'
    // DB 里最近一条 tool 消息的 content 是 JSON blocks
    mockMessageListBySession.mockReturnValue([
      {
        id: 'm1',
        session_id: 's1',
        role: 'tool',
        agent_id: '__chat__',
        created_at: 'x',
        content: JSON.stringify([
          { type: 'tool_result', output: realToolText, toolCallId: 'tc1', toolName: 'read' },
        ]),
      },
    ])

    const fabricatedSummary =
      'Summary: "all 42 records inserted successfully into the database without error"'
    setupFallbackScenarioWithSummary(fabricatedSummary)

    const opts = makeOpts({
      maxSteps: 2,
      agent: {
        id: '__chat__',
        toolRegistry: { listTools: () => [], getToolNames: () => ['read'], listMcpTools: () => [] },
      } as unknown as ReactLoopOptions['agent'],
    })
    await runReactLoop(opts)

    // 找到落库的兜底摘要消息
    const summaryCall = mockMessageCreate.mock.calls.find(
      (c) =>
        Array.isArray(c[0].content) &&
        typeof c[0].content[0]?.text === 'string' &&
        c[0].content[0].text.startsWith('[auto-summary'),
    )
    expect(summaryCall).toBeDefined()
    const text = summaryCall![0].content[0].text as string
    expect(text).toMatch(/^\[auto-summary • 1 unverifiable quote masked\]/)
    expect(text).toContain('⟨unverifiable⟩')
    expect(text).not.toContain('42 records inserted')
  })

  it('fallback 摘要里命中真实 tool_output 的长引用不被替换', async () => {
    const realToolText =
      'The server responded with "authentication token expired, please login again"'
    mockMessageListBySession.mockReturnValue([
      {
        id: 'm1',
        session_id: 's1',
        role: 'tool',
        agent_id: '__chat__',
        created_at: 'x',
        content: JSON.stringify([
          { type: 'tool_result', output: realToolText, toolCallId: 'tc1', toolName: 'bash' },
        ]),
      },
    ])

    const summary = 'Result: "authentication token expired, please login again"'
    setupFallbackScenarioWithSummary(summary)

    const opts = makeOpts({
      maxSteps: 2,
      agent: {
        id: '__chat__',
        toolRegistry: { listTools: () => [], getToolNames: () => ['bash'], listMcpTools: () => [] },
      } as unknown as ReactLoopOptions['agent'],
    })
    await runReactLoop(opts)

    const summaryCall = mockMessageCreate.mock.calls.find(
      (c) =>
        Array.isArray(c[0].content) &&
        typeof c[0].content[0]?.text === 'string' &&
        c[0].content[0].text.startsWith('[auto-summary'),
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
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      call++
      if (call === 1) {
        fireToolCall(params, 'tc1', toolName, { x: 1 })
        return {
          consumeStream: vi.fn().mockResolvedValue(undefined),
          toolResults: Promise.resolve([]),
        }
      }
      params.onChunk?.({ chunk: { type: 'text-delta', text: 'done\n\n✓ Done' } })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([]),
      }
    })
  }

  function agentWithRegistered(
    names: string[],
    mcpNames: string[] = [],
  ): ReactLoopOptions['agent'] {
    return {
      id: '__chat__',
      toolRegistry: {
        listTools: () => [],
        getToolNames: () => names,
        listMcpTools: () => mcpNames.map((n) => ({ name: n, description: '', parameters: {} })),
      },
    } as unknown as ReactLoopOptions['agent']
  }

  it('unknown tool name: injects "Tool not found" + available list', async () => {
    setupToolCallThenFinalText('nonexistent_tool')

    const opts = makeOpts({
      maxSteps: 3,
      agent: agentWithRegistered(['bash', 'read', 'write']),
    })
    await runReactLoop(opts)

    const batchCall = mockMessageCreateBatch.mock.calls[0][0] as Array<{
      role: string
      content: unknown
    }>
    const toolMsg = batchCall.find((m) => m.role === 'tool')
    const parts = JSON.parse(JSON.stringify(toolMsg?.content)) as Array<{
      output: { value: string }
    }>
    expect(parts[0].output.value).toMatch(/Tool not found: "nonexistent_tool"/)
    expect(parts[0].output.value).toContain('bash, read, write')
  })

  it('known tool name but empty result: injects "execution failed, do NOT retry"', async () => {
    setupToolCallThenFinalText('bash')

    const opts = makeOpts({
      maxSteps: 3,
      agent: agentWithRegistered(['bash', 'read', 'write']),
    })
    await runReactLoop(opts)

    const batchCall = mockMessageCreateBatch.mock.calls[0][0] as Array<{
      role: string
      content: unknown
    }>
    const toolMsg = batchCall.find((m) => m.role === 'tool')
    const parts = JSON.parse(JSON.stringify(toolMsg?.content)) as Array<{
      output: { value: string }
    }>
    expect(parts[0].output.value).toMatch(/Tool execution failed: "bash"/)
    expect(parts[0].output.value).toMatch(/unlikely to help/)
    expect(parts[0].output.value).not.toMatch(/Tool not found/)
  })

  it('MCP tool called before search_tool: injects "not yet loaded" redirect message', async () => {
    // 在方案 B 下，MCP 工具不会被收回。但模型可能在 search_tool 之前就尝试调
    // 一个它"知道"存在的 MCP 工具（比如从训练历史/系统提示推断）。这种情况
    // 应给出引导消息而非误导性 "execution failed"。
    setupToolCallThenFinalText('browser_snapshot')

    const opts = makeOpts({
      maxSteps: 3,
      agent: agentWithRegistered(
        ['bash', 'read', 'browser_snapshot', 'search_tool'],
        ['browser_snapshot'], // browser_snapshot is in MCP but NOT yet loaded (search_tool not called)
      ),
      pipeline: {
        build: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'hi' }],
          tools: [
            { name: 'bash', description: '', parameters: {} },
            { name: 'read', description: '', parameters: {} },
            { name: 'search_tool', description: '', parameters: {} },
          ],
        }),
      } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const batchCall = mockMessageCreateBatch.mock.calls[0][0] as Array<{
      role: string
      content: unknown
    }>
    const toolMsg = batchCall.find((m) => m.role === 'tool')
    const parts = JSON.parse(JSON.stringify(toolMsg?.content)) as Array<{
      output: { value: string }
    }>
    expect(parts[0].output.value).toMatch(/MCP tool "browser_snapshot" is not yet loaded/)
    expect(parts[0].output.value).toMatch(/search_tool/)
    expect(parts[0].output.value).not.toMatch(/Tool execution failed/)
    expect(parts[0].output.value).not.toMatch(/Tool not found/)
  })
})

describe('runReactLoop — Plan C cumulative-used MCP exposure (TASK-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue({})
  })

  function setupScriptedSteps(
    scripts: Array<{ toolNames: string[]; text?: string; toolOutputs?: string[] }>,
  ) {
    let stepIdx = 0
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      const script = scripts[stepIdx] ?? { toolNames: [] }
      stepIdx++
      const text = script.text ?? ''
      if (text) params.onChunk?.({ chunk: { type: 'text-delta', text } })
      const toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
      script.toolNames.forEach((name, i) => {
        const toolCallId = `tc-${stepIdx}-${i}`
        const input = { idx: i }
        const output = script.toolOutputs?.[i] ?? `${name} ok`
        fireToolCall(params, toolCallId, name, input, output)
        toolCalls.push({ toolCallId, toolName: name, input })
      })
      const toolResults = toolCalls.map((tc, i) => ({
        type: 'tool-result' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
        output: script.toolOutputs?.[i] ?? `${tc.toolName} ok`,
        dynamic: true as const,
      }))
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve(toolResults),
      }
    })
  }

  /**
   * agent mock with both `getToolNames` (used by react-loop fallback) and
   * `listMcpTools` (used by react-loop to classify tool names as MCP).
   */
  function makeAgentWithRegistered(
    allNames: string[],
    mcpNames: string[],
  ): ReactLoopOptions['agent'] {
    return {
      id: '__chat__',
      toolRegistry: {
        listTools: () => allNames.map((n) => ({ name: n, description: '', parameters: {} })),
        getToolNames: () => allNames,
        listMcpTools: () => mcpNames.map((n) => ({ name: n, description: '', parameters: {} })),
        execute: vi.fn(),
      },
    } as unknown as ReactLoopOptions['agent']
  }

  function captureFlags(buildFn: ReturnType<typeof vi.fn>) {
    return buildFn.mock.calls.map((c) => {
      const ctx = c[0] as {
        mcpExpandThisStep?: boolean
        usedMcpToolNames?: string[]
      }
      return {
        expand: ctx.mcpExpandThisStep,
        used: ctx.usedMcpToolNames ?? [],
      }
    })
  }

  it('AC-6-1: first step has expand=false, used=[]', async () => {
    setupScriptedSteps([{ toolNames: [], text: 'done\n\n✓ Done' }])
    const buildFn = vi
      .fn()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    const opts = makeOpts({
      pipeline: { build: buildFn } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    expect(buildFn).toHaveBeenCalledTimes(1)
    const flags = captureFlags(buildFn)
    expect(flags[0]).toEqual({ expand: false, used: [] })
  })

  it('AC-6-2: search_tool call → next step expand=true, then resets', async () => {
    setupScriptedSteps([
      { toolNames: ['search_tool'] },
      { toolNames: ['m1'] },
      { toolNames: [], text: 'done\n\n✓ Done' },
    ])
    const buildFn = vi
      .fn()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    const opts = makeOpts({
      maxSteps: 5,
      agent: makeAgentWithRegistered(['search_tool', 'm1'], ['m1']),
      pipeline: { build: buildFn } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    expect(buildFn).toHaveBeenCalledTimes(3)
    const flags = captureFlags(buildFn)
    // step 0 默认 expand=true（已注册 MCP 工具时的初始状态，避免强制双跳）
    expect(flags[0]).toEqual({ expand: true, used: [] })
    expect(flags[1]).toEqual({ expand: true, used: [] }) // post-search_tool expansion
    expect(flags[2]).toEqual({ expand: false, used: ['m1'] }) // m1 added to used set
  })

  it('AC-6-3: cumulative used MCP names across steps', async () => {
    setupScriptedSteps([
      { toolNames: ['search_tool'] }, // step 0 → next expand
      { toolNames: ['m1'] }, // step 1: expand=true, picks m1
      { toolNames: ['m1'] }, // step 2: expand=false, used=[m1], reuse m1
      { toolNames: ['search_tool'] }, // step 3: still used=[m1], next expand
      { toolNames: ['m2'] }, // step 4: expand=true, picks m2
      { toolNames: [], text: 'done\n\n✓ Done' },
    ])
    const buildFn = vi
      .fn()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    const opts = makeOpts({
      maxSteps: 10,
      agent: makeAgentWithRegistered(['search_tool', 'm1', 'm2'], ['m1', 'm2']),
      pipeline: { build: buildFn } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const flags = captureFlags(buildFn)
    // step 0 默认 expand=true（已注册 MCP 工具时的初始状态）
    expect(flags[0]).toEqual({ expand: true, used: [] })
    expect(flags[1]).toEqual({ expand: true, used: [] })
    expect(flags[2]).toEqual({ expand: false, used: ['m1'] })
    expect(flags[3]).toEqual({ expand: false, used: ['m1'] })
    expect(flags[4]).toEqual({ expand: true, used: ['m1'] })
    expect(flags[5]).toEqual({ expand: false, used: ['m1', 'm2'] })
  })

  it('builtin tools do not pollute used set', async () => {
    setupScriptedSteps([
      { toolNames: ['read', 'bash'] }, // builtin only
      { toolNames: ['search_tool'] },
      { toolNames: ['m1', 'glob'] }, // mix MCP + builtin
      { toolNames: [], text: 'done\n\n✓ Done' },
    ])
    const buildFn = vi
      .fn()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    const opts = makeOpts({
      maxSteps: 10,
      agent: makeAgentWithRegistered(['search_tool', 'm1', 'read', 'bash', 'glob'], ['m1']),
      pipeline: { build: buildFn } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const flags = captureFlags(buildFn)
    expect(flags[3].used).toEqual(['m1']) // only m1, not read/bash/glob
  })

  it('search_tool with simultaneous MCP call still expands next + adds to used', async () => {
    setupScriptedSteps([
      // Hypothetical: model calls search_tool AND m1 in same step (parallel)
      { toolNames: ['search_tool', 'm1'] },
      { toolNames: [], text: 'done\n\n✓ Done' },
    ])
    const buildFn = vi
      .fn()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    const opts = makeOpts({
      maxSteps: 5,
      agent: makeAgentWithRegistered(['search_tool', 'm1'], ['m1']),
      pipeline: { build: buildFn } as unknown as ReactLoopOptions['pipeline'],
    })
    await runReactLoop(opts)

    const flags = captureFlags(buildFn)
    expect(flags[1]).toEqual({ expand: true, used: ['m1'] })
  })
})

// ─────────────────────────────────────────────────────────────────────────
// v3.7: 无 tool = 自然 final (信任 LLM 自然语言)。
// ─────────────────────────────────────────────────────────────────────────
describe('runReactLoop — natural termination on no-tool step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
  })

  function setupScriptedSteps(scripts: Array<{ toolNames: string[]; text?: string }>) {
    let stepIdx = 0
    mockStreamText.mockImplementation((params: StreamTextParams) => {
      const script = scripts[stepIdx] ?? scripts[scripts.length - 1] ?? { toolNames: [] }
      stepIdx++
      const text = script.text ?? ''
      if (text) params.onChunk?.({ chunk: { type: 'text-delta', text } })
      const toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
      script.toolNames.forEach((name, i) => {
        const toolCallId = `tc-${stepIdx}-${i}`
        fireToolCall(params, toolCallId, name, { idx: i }, `${name} ok`)
        toolCalls.push({ toolCallId, toolName: name, input: { idx: i } })
      })
      const toolResults = toolCalls.map((tc) => ({
        type: 'tool-result' as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
        output: `${tc.toolName} ok`,
        dynamic: true as const,
      }))
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve(toolResults),
      }
    })
  }

  it('含 ✓ Done marker → 单步 exit,落 final 用 ctx.messageId', async () => {
    setupScriptedSteps([{ toolNames: [], text: 'task complete\n\n✓ Done — finished' }])
    const opts = makeOpts()
    await runReactLoop(opts)

    // 单次 messageRepo.create 调用,且 id === messageId (final 标记)
    expect(mockMessageCreate).toHaveBeenCalledTimes(1)
    const call = mockMessageCreate.mock.calls[0][0]
    expect(call.id).toBe(opts.messageId)
    expect(call.role).toBe('assistant')
  })

  it('含 ❓ Need input marker → 单步 exit', async () => {
    setupScriptedSteps([
      { toolNames: [], text: 'I need your input.\n\n❓ Need input — workspace path?' },
    ])
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(mockMessageCreate).toHaveBeenCalledTimes(1)
    expect(mockMessageCreate.mock.calls[0][0].id).toBe(opts.messageId)
  })

  it('含 ⏸ Blocked marker → 单步 exit', async () => {
    setupScriptedSteps([{ toolNames: [], text: 'Cannot proceed.\n\n⏸ Blocked — missing API key' }])
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(mockMessageCreate).toHaveBeenCalledTimes(1)
    expect(mockMessageCreate.mock.calls[0][0].id).toBe(opts.messageId)
  })

  it('v3.7: 无 marker 的纯文本 → 同样单步 exit,落 final 用 ctx.messageId', async () => {
    // v3.7 行为变化: "无 tool = 总是 final"。
    // 不再有 "无 marker → intermediate + continue" 路径,
    // 不再有 PENDING_MARKER_HINT 注入,
    // 不再有 forced-closure 兜底。
    setupScriptedSteps([{ toolNames: [], text: 'preparing to start' }])
    const opts = makeOpts({ maxSteps: 5 })
    await runReactLoop(opts)

    expect(mockMessageCreate).toHaveBeenCalledTimes(1)
    expect(mockMessageCreate.mock.calls[0][0].id).toBe(opts.messageId)
    // streamText 只调用一次, 没有后续 step 的 hint 注入
    expect(mockStreamText).toHaveBeenCalledTimes(1)
  })

  it('v3.7: 模型问问题 (无 marker) → 自然 final, 不进 forced-closure', async () => {
    // 回归截图灾难: 模型列了 "目标市场? 内地/香港/日本" 这种问题,
    // v3.6 走 no-marker streak → forced-closure → 模型自答 "好,日本市场" → 灾难。
    // v3.7 直接落 final 等用户回答, 路径不存在了。
    setupScriptedSteps([
      { toolNames: [], text: '目标市场是哪里? 内地 / 香港 / 日本 / 东南亚 / 欧美?' },
    ])
    const opts = makeOpts({ maxSteps: 10 })
    await runReactLoop(opts)

    // 单步 final, 不会有多次 create
    expect(mockMessageCreate).toHaveBeenCalledTimes(1)
    expect(mockMessageCreate.mock.calls[0][0].id).toBe(opts.messageId)
    // 没有 [forced-closure] 消息存在
    const hasForceClosure = mockMessageCreate.mock.calls.some((c) => {
      const content = (c[0] as { content: Array<{ text: string }> }).content
      return content[0]?.text?.includes('[forced-closure]')
    })
    expect(hasForceClosure).toBe(false)
  })

  it('v3.7: tool → text(无 marker) → 自然 final (两步 exit)', async () => {
    // step 0 调工具 → continue
    // step 1 纯文本无 marker → 自然 final
    setupScriptedSteps([
      { toolNames: ['t1'], text: 'calling t1' },
      { toolNames: [], text: 'all done based on t1 result' },
    ])
    const opts = makeOpts({
      maxSteps: 10,
      agent: {
        id: '__chat__',
        toolRegistry: {
          listTools: () => [{ name: 't1', description: '', parameters: {} }],
          getToolNames: () => ['t1'],
          listMcpTools: () => [],
          execute: vi.fn(),
        },
      } as unknown as ReactLoopOptions['agent'],
    })
    await runReactLoop(opts)

    // step 1 自然 final 用 messageId (step 0 走 createBatch 不进 mockMessageCreate)
    expect(mockMessageCreate).toHaveBeenCalled()
    const lastCreate = mockMessageCreate.mock.calls[mockMessageCreate.mock.calls.length - 1][0]
    expect(lastCreate.id).toBe(opts.messageId)
    // 不应触发 forced-closure
    const hasForceClosure = mockMessageCreate.mock.calls.some((c) => {
      const content = (c[0] as { content: Array<{ text: string }> }).content
      return content[0]?.text?.includes('[forced-closure]')
    })
    expect(hasForceClosure).toBe(false)
  })
})
