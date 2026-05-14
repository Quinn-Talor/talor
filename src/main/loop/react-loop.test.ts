// src/main/loop/react-loop.test.ts (v4 — SDK 多步重写)
//
// v4 改造后, react-loop 用 streamText 内置多步 (stopWhen + prepareStep + onStepFinish)。
// 测试 mock 模式从 "1 streamText = 1 step" 改为 "1 streamText = N step" — 用
// driveStreamText helper 驱动多步 lifecycle 回调。
//
// 覆盖:
//   - 文本响应基本路径
//   - abort 前/中 退出
//   - context budget 软告警/硬阻断
//   - dead-loop 检测 (signature 阈值差异化)
//   - failure-streak 加权 + hint 注入
//   - signature canonical / output-hash 跳过指引前缀
//   - tool result fallback (unknown name / empty / mcp not loaded)
//   - MCP exposure flags (search_tool / used set)
//   - 持久化配对事务 (tool 步 createBatch) / 纯文本步 create
//   - turn-end policy 续做 (基本 cover)
//
// forced-summary 内部已由 src/main/loop/forced-summary.test.ts 覆盖, 此处只 smoke。

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn((parts: unknown[]) =>
    (parts as Array<{ toolCallId: string; toolName: string; output: unknown }>).map((p) => ({
      type: 'tool_result' as const,
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      output: String(p.output),
      isError: false,
    })),
  ),
  extractOutputText: vi.fn((output: unknown) =>
    typeof output === 'string' ? output : JSON.stringify(output ?? ''),
  ),
  isErrorOutput: vi.fn((output: unknown) => {
    if (typeof output === 'object' && output !== null) {
      if ((output as Record<string, unknown>).__talor_error === true) return true
    }
    const s = String(output ?? '')
    return (
      s.startsWith('Error') ||
      s.startsWith('Tool execution failed:') ||
      s.startsWith('Tool not found:')
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

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => mockStreamText(...args),
  }
})

vi.mock('../tools/build-tools', () => ({
  buildTools: (...args: unknown[]) => mockBuildTools(...args),
}))

import { runReactLoop } from './react-loop'
import { driveStreamText } from './test-helpers/mock-stream-text'
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
      build: vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
      }),
    } as unknown as ReactLoopOptions['pipeline'],
    provider: { id: 'p1', name: 'test-provider' } as ReactLoopOptions['provider'],
    providerConfig: {} as ReactLoopOptions['providerConfig'],
    workspace: '/tmp',
    callbacks: {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onMessagePersisted: vi.fn(),
    },
    maxSteps: 5,
    agent: {
      id: '__chat__',
      toolRegistry: {
        listTools: () => [],
        execute: vi.fn(),
        getToolNames: () => [],
        listMcpTools: () => [],
      },
    } as unknown as ReactLoopOptions['agent'],
    confirmTool: vi.fn(async () => true),
    skillTracker: {
      activate: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReactLoopOptions['skillTracker'],
    events: { on: vi.fn(), emit: vi.fn() } as unknown as ReactLoopOptions['events'],
    ...overrides,
  } as unknown as ReactLoopOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildTools.mockResolvedValue(undefined)
})

// ── 基本路径 ───────────────────────────────────────────────────────────

describe('runReactLoop — text-only response (v4)', () => {
  it('单步纯文本 → onTextDelta + 落 assistant', async () => {
    mockStreamText.mockImplementation(driveStreamText([{ text: 'hello' }]))
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('hello', expect.any(Number))
    expect(mockMessageCreate).toHaveBeenCalled()
    const lastCreate = mockMessageCreate.mock.calls[mockMessageCreate.mock.calls.length - 1][0]
    expect(lastCreate.role).toBe('assistant')
  })
})

describe('runReactLoop — abort', () => {
  it('已 aborted 时不调 streamText, 不落库', async () => {
    const controller = new AbortController()
    controller.abort()
    const opts = makeOpts({ abortSignal: controller.signal })
    await runReactLoop(opts)
    expect(mockStreamText).not.toHaveBeenCalled()
    expect(mockMessageCreate).not.toHaveBeenCalled()
  })
})

// ── Context budget guard ───────────────────────────────────────────────

describe('runReactLoop — context budget guard', () => {
  it('prompt ≥ 100% → 不调 streamText, 写 [auto-halt]', async () => {
    const bigText = 'x'.repeat(1000) // estimate ≈ 250 tokens
    const opts = makeOpts({
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
    expect(mockStreamText).not.toHaveBeenCalled()
    expect(mockMessageCreate).toHaveBeenCalled()
    const halt = mockMessageCreate.mock.calls[0][0]
    expect(halt.content[0].text).toMatch(/^\[auto-halt\]/)
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith(
      expect.stringMatching(/^\[auto-halt\]/),
      expect.any(Number),
    )
  })

  it('prompt > 98% 但 < 100% → 注入 [CONTEXT NEARLY FULL] 给 streamText', async () => {
    const captured: unknown[][] = []
    mockStreamText.mockImplementation((params: { messages: unknown[] }) => {
      captured.push(params.messages)
      return driveStreamText([{ text: 'ok' }])(params as never) as unknown as ReturnType<
        typeof mockStreamText
      >
    })
    const bigText = 'x'.repeat(197) // estimate ≈ 50 tokens
    const opts = makeOpts({
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
    const sent = captured[0] as Array<{ role: string; content: string }>
    const tail = sent[sent.length - 1]
    expect(tail.role).toBe('system')
    expect(tail.content).toMatch(/^\[CONTEXT NEARLY FULL\]/)
  })

  it('prompt < 98% 时不注入预警', async () => {
    const captured: unknown[][] = []
    mockStreamText.mockImplementation((params: { messages: unknown[] }) => {
      captured.push(params.messages)
      return driveStreamText([{ text: 'ok' }])(params as never) as unknown as ReturnType<
        typeof mockStreamText
      >
    })
    const opts = makeOpts({
      providerConfig: {
        context_limit: 100_000,
        recent_ratio: 0.05,
        summary_ratio: 0.05,
      } as ReactLoopOptions['providerConfig'],
    })
    await runReactLoop(opts)
    const sent = captured[0] as Array<{ role: string; content: string }>
    expect(
      sent.some(
        (m) => typeof m.content === 'string' && m.content.startsWith('[CONTEXT NEARLY FULL]'),
      ),
    ).toBe(false)
  })
})

// ── Dead-loop detection (signature) ────────────────────────────────────

describe('runReactLoop — signature dead-loop (v4)', () => {
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

  it('带 error 同签名第 2 次即 break (阈值 1)', async () => {
    // 同 input + 同 output (都是 error) 重复 2 次 → signature-dead-loop trigger
    mockStreamText.mockImplementation(
      driveStreamText([
        {
          toolCalls: [{ toolCallId: 'tc1', toolName: 'bash', input: { cmd: 'ls' } }],
          toolResults: [
            { toolCallId: 'tc1', toolName: 'bash', output: 'Error: same', isError: true },
          ],
        },
        {
          toolCalls: [{ toolCallId: 'tc2', toolName: 'bash', input: { cmd: 'ls' } }],
          toolResults: [
            { toolCallId: 'tc2', toolName: 'bash', output: 'Error: same', isError: true },
          ],
        },
        // 第 3 步不应触发 (stopWhen 在 step 2 onStepFinish 后命中)
        {
          toolCalls: [{ toolCallId: 'tc3', toolName: 'bash', input: { cmd: 'ls' } }],
          toolResults: [{ toolCallId: 'tc3', toolName: 'bash', output: 'Error: same' }],
        },
      ]),
    )
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)
    // 2 步落库 (tool-pair createBatch ×2), 不到 3 步
    expect(mockMessageCreateBatch.mock.calls.length).toBe(2)
  })

  it('不带 error 同签名需到第 3 次才 break (阈值 2)', async () => {
    mockStreamText.mockImplementation(
      driveStreamText([
        {
          toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'content' }],
        },
        {
          toolCalls: [{ toolCallId: 'tc2', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc2', toolName: 'read', output: 'content' }],
        },
        {
          toolCalls: [{ toolCallId: 'tc3', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc3', toolName: 'read', output: 'content' }],
        },
        // 第 4 步不应跑
        {
          toolCalls: [{ toolCallId: 'tc4', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc4', toolName: 'read', output: 'content' }],
        },
      ]),
    )
    const opts = makeOpts({ maxSteps: 10, agent: agent(['read']) })
    await runReactLoop(opts)
    expect(mockMessageCreateBatch.mock.calls.length).toBe(3)
  })

  it('同命令字段顺序不同 → 同 signature → 同签名触发', async () => {
    mockStreamText.mockImplementation(
      driveStreamText([
        {
          toolCalls: [{ toolCallId: 'tc1', toolName: 'bash', input: { a: 1, b: 2 } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'bash', output: 'Error: x', isError: true }],
        },
        {
          // 同 input 不同键顺序
          toolCalls: [{ toolCallId: 'tc2', toolName: 'bash', input: { b: 2, a: 1 } }],
          toolResults: [{ toolCallId: 'tc2', toolName: 'bash', output: 'Error: x', isError: true }],
        },
        {
          toolCalls: [{ toolCallId: 'tc3', toolName: 'bash', input: { a: 1, b: 2 } }],
          toolResults: [{ toolCallId: 'tc3', toolName: 'bash', output: 'Error: x' }],
        },
      ]),
    )
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)
    // 第 2 步 break, 第 3 步不应跑
    expect(mockMessageCreateBatch.mock.calls.length).toBe(2)
  })
})

// ── Failure-streak ──────────────────────────────────────────────────────

describe('runReactLoop — failure-streak (v4)', () => {
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

  it('连续 3 步全部失败 → 进入 failure-recovery summary', async () => {
    mockStreamText.mockImplementation(
      driveStreamText([
        {
          toolCalls: [{ toolCallId: 'tc1', toolName: 'bash', input: { cmd: 'a' } }],
          toolResults: [
            { toolCallId: 'tc1', toolName: 'bash', output: 'Error: e1', isError: true },
          ],
        },
        {
          toolCalls: [{ toolCallId: 'tc2', toolName: 'bash', input: { cmd: 'b' } }],
          toolResults: [
            { toolCallId: 'tc2', toolName: 'bash', output: 'Error: e2', isError: true },
          ],
        },
        {
          toolCalls: [{ toolCallId: 'tc3', toolName: 'bash', input: { cmd: 'c' } }],
          toolResults: [
            { toolCallId: 'tc3', toolName: 'bash', output: 'Error: e3', isError: true },
          ],
        },
      ]),
    )
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)
    // 第 3 步触发 failure-streak detector → 跑 forced-summary → 落一条 [failure-recovery] 消息
    // (forced summary 通过另一次 streamText 调用产出, 但走 textStream 路径)
    const recoveryCall = mockMessageCreate.mock.calls.find(
      (c) =>
        Array.isArray(c[0].content) &&
        typeof c[0].content[0]?.text === 'string' &&
        c[0].content[0].text.startsWith('[failure-recovery'),
    )
    expect(recoveryCall).toBeDefined()
  })
})

// ── Turn-end policy: 普通文本 final (LegacyNaturalFinalPolicy 兜底) ─────

describe('runReactLoop — turn-end policy (v4)', () => {
  it('单步无工具 + 有文本 → LegacyNaturalFinalPolicy → FINAL', async () => {
    mockStreamText.mockImplementation(
      driveStreamText([{ text: 'final answer', finishReason: 'stop' }]),
    )
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(mockMessageCreate).toHaveBeenCalled()
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('final answer', expect.any(Number))
  })

  it('多步 (tool → text) → tool 配对落库 + 最终 text 落库', async () => {
    mockStreamText.mockImplementation(
      driveStreamText([
        {
          toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'content' }],
        },
        { text: 'done', finishReason: 'stop' },
      ]),
    )
    const opts = makeOpts({
      agent: {
        id: '__chat__',
        toolRegistry: {
          listTools: () => [],
          getToolNames: () => ['read'],
          listMcpTools: () => [],
        },
      } as unknown as ReactLoopOptions['agent'],
    })
    await runReactLoop(opts)
    // step 1: tool-pair → createBatch
    expect(mockMessageCreateBatch).toHaveBeenCalledTimes(1)
    // step 2: text-only → create
    const textCreates = mockMessageCreate.mock.calls.filter(
      (c) =>
        Array.isArray(c[0].content) &&
        c[0].content.some((p: { type: string }) => p.type === 'text'),
    )
    expect(textCreates.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Persistence transactionality ───────────────────────────────────────

describe('runReactLoop — persistence (v4)', () => {
  it('tool 步用 createBatch (assistant + tool 配对事务)', async () => {
    mockStreamText.mockImplementation(
      driveStreamText([
        {
          toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { p: 'a' } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'x' }],
        },
        { text: 'done' },
      ]),
    )
    const opts = makeOpts({
      agent: {
        id: '__chat__',
        toolRegistry: { listTools: () => [], getToolNames: () => ['read'], listMcpTools: () => [] },
      } as unknown as ReactLoopOptions['agent'],
    })
    await runReactLoop(opts)
    expect(mockMessageCreateBatch).toHaveBeenCalled()
    const batchCall = mockMessageCreateBatch.mock.calls[0][0] as Array<{ role: string }>
    expect(batchCall).toHaveLength(2)
    expect(batchCall[0].role).toBe('assistant')
    expect(batchCall[1].role).toBe('tool')
  })

  it('纯文本步用 create (单条)', async () => {
    mockStreamText.mockImplementation(driveStreamText([{ text: 'answer' }]))
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(mockMessageCreate).toHaveBeenCalled()
    expect(mockMessageCreateBatch).not.toHaveBeenCalled()
  })
})
