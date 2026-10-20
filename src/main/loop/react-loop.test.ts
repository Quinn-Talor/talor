// src/main/loop/react-loop.test.ts
//
// 测试模式: 1 mockStreamText 调用 = 1 step。mock 内部构造 SDK StepResult
// 供 persistStepFromResult + factsFromStep 消费。
//
// 覆盖:
//   - 文本响应基本路径
//   - abort 前/中 退出
//   - context budget 软告警 / 硬阻断
//   - dead-loop 检测 (signature 阈值差异化)
//   - failure-streak (3 步全失败 → forced-recovery summary)
//   - turn-end policy 续做 + final
//   - 持久化配对事务 (tool 步 createBatch) / 纯文本步 create

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StepResult, ToolSet } from 'ai'
import { DEFAULT_TRACE_CONFIG, type ObservationRecord } from '@shared/types/trace'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  buildStreamTimeout: vi.fn((signal: AbortSignal) => ({
    signal,
    ping: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
  })),
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
import type { ReactLoopOptions } from './types'
import { traceRecorder } from '../observe/trace-recorder'
import { traceRepo } from '../repos/trace-repo'
import { runInScope } from '../observe/trace-context'
import { ContextBudgetReflector } from './reflect/context-budget'
import { SignatureDeadLoop } from './detectors/signature-dead-loop'
import { LengthTruncationStreak } from './detectors/length-truncation-streak'
import { FailureStreakReflector } from './reflect/failure-streak'
import { ToolOnlyLoopReflector } from './reflect/tool-only-loop'
import { PeriodicReflector } from './reflect/periodic'
import { EscalationReflector } from './reflect/escalation'
import { JudgeCompletionReflector } from './reflect/judge-completion'
import { QuoteCorrectionReflector } from './reflect/quote-correction'
import { ExplicitTerminationBlockPolicy } from './turn-end-policies/explicit-termination'
import { estimate } from '../memory/types'

// ── 测试 helpers ───────────────────────────────────────────────────────

/**
 * 构造一个最小 StepResult (mock). 只填 react-loop / step-adapter / persist-step
 * 实际消费的字段, 其余以 unknown 断言补齐 SDK 类型。
 */
function makeStepResult(o: {
  text?: string
  reasoning?: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
  toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown }>
  finishReason?: import('ai').FinishReason
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
}): StepResult<ToolSet> {
  return {
    text: o.text ?? '',
    reasoningText: o.reasoning,
    reasoning: o.reasoning ? [{ type: 'reasoning', text: o.reasoning }] : [],
    toolCalls: (o.toolCalls ?? []) as unknown as StepResult<ToolSet>['toolCalls'],
    toolResults: (o.toolResults ?? []) as unknown as StepResult<ToolSet>['toolResults'],
    finishReason: o.finishReason ?? 'stop',
    usage: (o.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) as never,
    warnings: undefined as never,
    providerMetadata: undefined as never,
    content: [],
    files: [],
    sources: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    staticToolResults: [],
    dynamicToolResults: [],
    rawFinishReason: undefined,
    request: {} as never,
    response: { messages: [] } as never,
  } as unknown as StepResult<ToolSet>
}

/**
 * 单步 streamText mock impl — 驱动 onChunk + tool lifecycle, 返 result.steps[0] 等。
 */
type StepDef = {
  text?: string
  reasoning?: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
  toolResults?: Array<{
    toolCallId: string
    toolName: string
    output: unknown
    isError?: boolean
    durationMs?: number
  }>
  finishReason?: import('ai').FinishReason
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
}

function mockSingleStep(step: StepDef) {
  return (params: {
    onChunk?: (arg: { chunk: { type: string; text?: string } }) => void
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
    messages?: unknown[]
  }) => {
    // forced-summary 路径检测: 缺 onChunk + 缺 tool callbacks → textStream only
    if (!params.onChunk && !params.experimental_onToolCallStart) {
      const text = step.text ?? ''
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        textStream: (async function* () {
          if (text) yield text
        })(),
      }
    }

    // 主路径: 流式 text + tool lifecycle
    if (step.text) {
      params.onChunk?.({ chunk: { type: 'text-delta', text: step.text } })
    }
    if (step.reasoning) {
      params.onChunk?.({ chunk: { type: 'reasoning-delta', text: step.reasoning } })
    }
    for (const tc of step.toolCalls ?? []) {
      params.experimental_onToolCallStart?.({ toolCall: tc })
      const result = step.toolResults?.find((tr) => tr.toolCallId === tc.toolCallId)
      if (!result) {
        params.experimental_onToolCallFinish?.({
          toolCall: tc,
          durationMs: 1,
          success: false,
          error: 'no result mocked',
        })
        continue
      }
      if (result.isError) {
        params.experimental_onToolCallFinish?.({
          toolCall: tc,
          durationMs: result.durationMs ?? 1,
          success: false,
          error: result.output,
        })
      } else {
        params.experimental_onToolCallFinish?.({
          toolCall: tc,
          durationMs: result.durationMs ?? 1,
          success: true,
          output: result.output,
        })
      }
    }

    const stepResult = makeStepResult(step)
    return {
      consumeStream: vi.fn().mockResolvedValue(undefined),
      steps: Promise.resolve([stepResult]),
      toolResults: Promise.resolve(step.toolResults ?? []),
      finishReason: Promise.resolve(stepResult.finishReason),
      usage: Promise.resolve(stepResult.usage),
      providerMetadata: Promise.resolve(undefined),
      warnings: Promise.resolve([]),
    }
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

describe('runReactLoop — text-only response', () => {
  it('单步纯文本 → onTextDelta + 落 assistant', async () => {
    mockStreamText.mockImplementation(mockSingleStep({ text: 'hello' }))
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('hello', expect.any(Number))
    expect(mockMessageCreate).toHaveBeenCalled()
    const lastCreate = mockMessageCreate.mock.calls[mockMessageCreate.mock.calls.length - 1][0]
    expect(lastCreate.role).toBe('assistant')
  })
})

describe('runReactLoop — providerOptions 合并（AC-013）', () => {
  it('adapter 默认值 + provider.provider_options 同 provider-key 下并集共存，不互相覆盖', async () => {
    mockStreamText.mockImplementation(mockSingleStep({ text: 'hello' }))
    const opts = makeOpts({
      provider: {
        id: 'p1',
        name: 'test-provider',
        provider_options: { openai: { reasoningEffort: 'high' } },
      } as unknown as ReactLoopOptions['provider'],
      streamOptions: { providerOptions: { openai: { parallelToolCalls: true } } },
    })
    await runReactLoop(opts)
    const [[params]] = mockStreamText.mock.calls
    expect((params as { providerOptions: unknown }).providerOptions).toEqual({
      openai: { parallelToolCalls: true, reasoningEffort: 'high' },
    })
  })

  it('provider.provider_options 未设置 → 结果等于 streamOptions.providerOptions 原值（不触发）', async () => {
    mockStreamText.mockImplementation(mockSingleStep({ text: 'hello' }))
    const opts = makeOpts({
      streamOptions: { providerOptions: { openai: { parallelToolCalls: true } } },
    })
    await runReactLoop(opts)
    const [[params]] = mockStreamText.mock.calls
    expect((params as { providerOptions: unknown }).providerOptions).toEqual({
      openai: { parallelToolCalls: true },
    })
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
    const bigText = 'x'.repeat(1000)
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
      return mockSingleStep({ text: 'ok' })(params as never) as unknown as ReturnType<
        typeof mockStreamText
      >
    })
    const bigText = 'x'.repeat(197)
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
      return mockSingleStep({ text: 'ok' })(params as never) as unknown as ReturnType<
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

// ── Dead-loop detection ─────────────────────────────────────────────────

describe('runReactLoop — signature dead-loop', () => {
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

  it('带 error 同签名第 2 次即 break (阈值 1) — streamText 2 次后停', async () => {
    const stepDef: StepDef = {
      toolCalls: [{ toolCallId: 'tc1', toolName: 'bash', input: { cmd: 'ls' } }],
      toolResults: [{ toolCallId: 'tc1', toolName: 'bash', output: 'Error: same', isError: true }],
    }
    mockStreamText.mockImplementation(mockSingleStep(stepDef))
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)
    // 第 2 步触发 dead-loop → break。主对话 streamText 调 2 次 (forced-summary 额外 1 次)
    const mainCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(mainCalls).toBe(2)
  })

  it('不带 error 同签名需到第 3 次才 break (阈值 2)', async () => {
    const stepDef: StepDef = {
      toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { path: 'a' } }],
      toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'content' }],
    }
    mockStreamText.mockImplementation(mockSingleStep(stepDef))
    const opts = makeOpts({ maxSteps: 10, agent: agent(['read']) })
    await runReactLoop(opts)
    const mainCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(mainCalls).toBe(3)
  })

  it('同命令字段顺序不同 → 同 signature → 同签名触发', async () => {
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      if (!(params as { onChunk?: unknown }).onChunk) {
        return mockSingleStep({})(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      stepIdx++
      const input = stepIdx === 2 ? { b: 2, a: 1 } : { a: 1, b: 2 } // 中间步顺序不同
      const stepDef: StepDef = {
        toolCalls: [{ toolCallId: `tc${stepIdx}`, toolName: 'bash', input }],
        toolResults: [
          {
            toolCallId: `tc${stepIdx}`,
            toolName: 'bash',
            output: 'Error: x',
            isError: true,
          },
        ],
      }
      return mockSingleStep(stepDef)(params as never) as unknown as ReturnType<
        typeof mockStreamText
      >
    })
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)
    // 第 2 步签名跟第 1 步相同 (canonical 化后) → 阈值 1 触发 break
    const mainCalls = mockStreamText.mock.calls.filter(
      (c) => (c[0] as { onChunk?: unknown })?.onChunk,
    ).length
    expect(mainCalls).toBe(2)
  })
})

// ── Failure-streak ──────────────────────────────────────────────────────

describe('runReactLoop — failure-streak', () => {
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
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      const hasOnChunk = (params as { onChunk?: unknown }).onChunk
      if (!hasOnChunk) {
        return mockSingleStep({ text: 'Tried 3 times, all failed.' })(
          params as never,
        ) as unknown as ReturnType<typeof mockStreamText>
      }
      stepIdx++
      return mockSingleStep({
        toolCalls: [
          { toolCallId: `tc${stepIdx}`, toolName: 'bash', input: { cmd: `c${stepIdx}` } },
        ],
        toolResults: [
          {
            toolCallId: `tc${stepIdx}`,
            toolName: 'bash',
            output: `Error: e${stepIdx}`,
            isError: true,
          },
        ],
      })(params as never) as unknown as ReturnType<typeof mockStreamText>
    })
    const opts = makeOpts({ maxSteps: 10, agent: agent() })
    await runReactLoop(opts)

    // 第 3 步触发 failure-streak → forced-summary 跑一次, 落一条 [failure-recovery]
    const recoveryCall = mockMessageCreate.mock.calls.find(
      (c) =>
        Array.isArray(c[0].content) &&
        typeof c[0].content[0]?.text === 'string' &&
        c[0].content[0].text.startsWith('[failure-recovery'),
    )
    expect(recoveryCall).toBeDefined()
  })
})

// ── Turn-end policy ─────────────────────────────────────────────────────

describe('runReactLoop — turn-end policy', () => {
  it('单步无工具 + 有文本 → LegacyNaturalFinalPolicy → FINAL', async () => {
    mockStreamText.mockImplementation(
      mockSingleStep({ text: 'final answer', finishReason: 'stop' }),
    )
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(mockMessageCreate).toHaveBeenCalled()
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('final answer', expect.any(Number))
  })

  it('多步 (tool → text) → tool 配对 createBatch + 最终 text create', async () => {
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      if (!(params as { onChunk?: unknown }).onChunk) {
        return mockSingleStep({})(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      stepIdx++
      if (stepIdx === 1) {
        return mockSingleStep({
          toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'content' }],
        })(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      return mockSingleStep({ text: 'done', finishReason: 'stop' })(
        params as never,
      ) as unknown as ReturnType<typeof mockStreamText>
    })
    const opts = makeOpts({
      agent: {
        id: '__chat__',
        toolRegistry: { listTools: () => [], getToolNames: () => ['read'], listMcpTools: () => [] },
      } as unknown as ReactLoopOptions['agent'],
    })
    await runReactLoop(opts)
    // step 1: tool-pair createBatch
    expect(mockMessageCreateBatch).toHaveBeenCalledTimes(1)
    // step 2: text-only create
    const textCreates = mockMessageCreate.mock.calls.filter(
      (c) =>
        Array.isArray(c[0].content) &&
        c[0].content.some((p: { type: string }) => p.type === 'text'),
    )
    expect(textCreates.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Persistence transactionality ───────────────────────────────────────

describe('runReactLoop — persistence', () => {
  it('tool 步用 createBatch (assistant + tool 配对事务)', async () => {
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      if (!(params as { onChunk?: unknown }).onChunk) {
        return mockSingleStep({})(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      stepIdx++
      if (stepIdx === 1) {
        return mockSingleStep({
          toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { p: 'a' } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'x' }],
        })(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      return mockSingleStep({ text: 'done' })(params as never) as unknown as ReturnType<
        typeof mockStreamText
      >
    })
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
    mockStreamText.mockImplementation(mockSingleStep({ text: 'answer' }))
    const opts = makeOpts()
    await runReactLoop(opts)
    expect(mockMessageCreate).toHaveBeenCalled()
    expect(mockMessageCreateBatch).not.toHaveBeenCalled()
  })
})

// ── Turn trace 埋点（turn-trace TASK-4）────────────────────────────────

describe('runReactLoop — turn trace', () => {
  const REFLECTOR_CLASSES = [
    ContextBudgetReflector,
    SignatureDeadLoop,
    LengthTruncationStreak,
    FailureStreakReflector,
    ToolOnlyLoopReflector,
    PeriodicReflector,
    EscalationReflector,
    JudgeCompletionReflector,
    QuoteCorrectionReflector,
  ]

  let rows: Map<string, ObservationRecord>

  beforeEach(() => {
    rows = new Map()
    vi.spyOn(traceRepo, 'upsertBatch').mockImplementation((_trace, observations) => {
      for (const o of observations) rows.set(o.id, { ...o })
    })
    for (const C of REFLECTOR_CLASSES) {
      vi.spyOn(C.prototype, 'reflect').mockResolvedValue(null)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function scriptToolThenText() {
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      if (!(params as { onChunk?: unknown }).onChunk) {
        return mockSingleStep({})(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      stepIdx++
      if (stepIdx === 1) {
        return mockSingleStep({
          toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { path: 'a' } }],
          toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'content' }],
        })(params as never) as unknown as ReturnType<typeof mockStreamText>
      }
      return mockSingleStep({ text: 'done', finishReason: 'stop' })(
        params as never,
      ) as unknown as ReturnType<typeof mockStreamText>
    })
  }

  function toolAgentOpts() {
    return makeOpts({
      agent: {
        id: '__chat__',
        toolRegistry: { listTools: () => [], getToolNames: () => ['read'], listMcpTools: () => [] },
      } as unknown as ReactLoopOptions['agent'],
    })
  }

  async function runTraced(opts: ReactLoopOptions, id: string) {
    const scope = traceRecorder.startTrace({
      id,
      sessionId: opts.sessionId,
      name: 'turn',
      input: opts.userContent,
      rootName: 'agent:test',
      config: DEFAULT_TRACE_CONFIG,
    })
    const result = await runInScope(scope, () => runReactLoop(opts))
    traceRecorder.endTrace(id, {})
    return result
  }

  function steps(): ObservationRecord[] {
    return [...rows.values()]
      .filter((o) => o.type === 'CHAIN' && o.name === 'react.step')
      .sort((a, b) => Number(a.metadata.step_index) - Number(b.metadata.step_index))
  }

  function childrenOf(id: string): ObservationRecord[] {
    return [...rows.values()].filter((o) => o.parent_observation_id === id)
  }

  function count(children: ObservationRecord[], name: string, phase?: string, type?: string) {
    return children.filter(
      (o) =>
        o.name === name &&
        (phase === undefined || o.metadata.phase === phase) &&
        (type === undefined || o.type === type),
    ).length
  }

  it('AC-017: records steps, every guard evaluation, prompt/persist spans and the turn-end policy', async () => {
    scriptToolThenText()
    await runTraced(toolAgentOpts(), 't-structure')

    const [s0, s1] = steps()
    expect(steps()).toHaveLength(2)
    expect(s0.metadata.step_index).toBe(0)
    expect(s1.metadata.step_index).toBe(1)

    for (const step of [s0, s1]) {
      const kids = childrenOf(step.id)
      expect(count(kids, 'guard:context-budget', 'pre-step', 'GUARDRAIL')).toBe(1)
      expect(count(kids, 'guard:signature-dead-loop', 'detector', 'GUARDRAIL')).toBe(1)
      expect(count(kids, 'guard:length-truncation-streak', 'detector', 'GUARDRAIL')).toBe(1)
      for (const n of [
        'guard:signature-dead-loop',
        'guard:length-truncation-streak',
        'guard:failure-streak',
        'guard:tool-only-loop',
      ]) {
        expect(count(kids, n, 'post-step', 'GUARDRAIL')).toBe(1)
      }
      expect(count(kids, 'guard:periodic', 'post-step', 'EVALUATOR')).toBe(1)
      expect(count(kids, 'guard:escalation', 'post-step', 'EVALUATOR')).toBe(1)
      expect(
        kids.filter((o) => o.name.startsWith('guard:')).every((o) => o.level === 'DEBUG'),
      ).toBe(true)
      expect(count(kids, 'prompt.build', undefined, 'SPAN')).toBe(1)
      expect(count(kids, 'react.persist', undefined, 'SPAN')).toBe(1)
    }

    const s1Kids = childrenOf(s1.id)
    const policy = s1Kids.find((o) => o.name === 'react.turn-end-policy')!
    expect(policy.type).toBe('CHAIN')
    expect(policy.metadata.by).toBe('legacy-natural-final')
    expect(count(s1Kids, 'guard:judge-completion', 'turn-end', 'EVALUATOR')).toBe(1)
    expect(count(s1Kids, 'guard:quote-correction', 'turn-end', 'EVALUATOR')).toBe(1)
    expect(count(childrenOf(s0.id), 'react.turn-end-policy')).toBe(0)
    expect([...rows.values()].every((o) => o.end_time !== null)).toBe(true)
  })

  it('the step that ends the turn records metadata.exit, including the common FINAL-by-policy path', async () => {
    scriptToolThenText()
    await runTraced(toolAgentOpts(), 't-exit')

    const [s0, s1] = steps()
    expect(s1.metadata.exit).toBe('no_tool_calls')
    // 不结束本轮的步不带 exit
    expect(s0.metadata).not.toHaveProperty('exit')
  })

  it('policyExitReason is cleared when a turn-end reflector overturns the final', async () => {
    vi.spyOn(ExplicitTerminationBlockPolicy.prototype, 'evaluate').mockResolvedValue({
      action: 'final',
      exitReason: 'declared_final',
      reason: 'r',
    })
    vi.mocked(JudgeCompletionReflector.prototype.reflect)
      .mockResolvedValueOnce({
        internalNudge: { text: 'not done yet', label: 'judge', reason: 'r', role: 'user' },
      })
      .mockResolvedValue(null)
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      stepIdx++
      // 第 1 步 final 被 judge 推翻;第 2 步空文本 → empty_text 结束(policy 未再判 final)
      return mockSingleStep(stepIdx === 1 ? { text: 'draft', finishReason: 'stop' } : {})(
        params as never,
      ) as unknown as ReturnType<typeof mockStreamText>
    })

    const result = await runTraced(toolAgentOpts(), 't-overturn')

    expect(result.exitReason).toBe('empty_text')
    expect(result.policyExitReason).toBeNull()
  })

  it('AC-018: a carried-over hint is recorded as an EVENT with its source reflector', async () => {
    vi.mocked(FailureStreakReflector.prototype.reflect)
      .mockResolvedValueOnce({ hint: 'H1' })
      .mockResolvedValue(null)
    scriptToolThenText()
    await runTraced(toolAgentOpts(), 't-hint')

    const [s0, s1] = steps()
    const hint = childrenOf(s1.id).find((o) => o.name === 'hint.injected')!
    expect(hint).toMatchObject({ type: 'EVENT', input: 'H1' })
    expect(hint.metadata).toMatchObject({ source: 'failure-streak', phase: 'carry-over' })
    const guard = childrenOf(s0.id).find(
      (o) => o.name === 'guard:failure-streak' && o.metadata.phase === 'post-step',
    )!
    expect(guard.level).toBe('DEFAULT')
    expect(guard.metadata.outcome).toBe('hint')
  })

  it('AC-019: returns LoopResult with the policy exit reason the loop itself does not keep', async () => {
    vi.spyOn(ExplicitTerminationBlockPolicy.prototype, 'evaluate').mockResolvedValue({
      action: 'final',
      exitReason: 'declared_final',
      reason: 'r',
    })
    scriptToolThenText()
    const result = await runTraced(toolAgentOpts(), 't-result')

    expect(result).toEqual({
      exitReason: 'no_tool_calls',
      policyExitReason: 'declared_final',
      totalSteps: 2,
      totalToolCalls: 1,
    })
    const policy = [...rows.values()].find((o) => o.name === 'react.turn-end-policy')!
    expect(policy.metadata).toMatchObject({
      by: 'explicit-termination',
      exit_reason: 'declared_final',
    })
  })

  it('LoopResult without tracing: abort before the first step → abort, zero steps', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runReactLoop(makeOpts({ abortSignal: controller.signal }))
    expect(result).toEqual({
      exitReason: 'abort',
      policyExitReason: null,
      totalSteps: 0,
      totalToolCalls: 0,
    })
    expect(rows.size).toBe(0)
  })
})

describe('runReactLoop — context budget estimate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 第 1 步提供 40 个大工具定义(MCP 全量),第 2 步工具集清空、多了一条工具结果 —— 与实测 294 → 14 同形
  const bigTools = Array.from({ length: 40 }, (_, i) => ({
    name: `mcp_tool_${i}`,
    description: 'x'.repeat(2000),
    parameters: { type: 'object' },
  }))
  const step2Messages = [
    { role: 'user', content: 'hello' },
    { role: 'user', content: 'y'.repeat(4000) },
  ]

  /** 跑两步,第 1 步的实际 input = 第 1 步估算 × actualRatio;返回两步的预算估算。 */
  async function runTwoSteps(actualRatio: number): Promise<number[]> {
    const seen: number[] = []
    vi.spyOn(ContextBudgetReflector.prototype, 'reflect').mockImplementation(async (ctx) => {
      if (ctx.phase === 'pre-step') seen.push(ctx.estimatedTokens)
      return null
    })
    const build = vi
      .fn()
      .mockResolvedValueOnce({ messages: [{ role: 'user', content: 'hello' }], tools: bigTools })
      .mockResolvedValue({ messages: step2Messages, tools: [] })
    let stepIdx = 0
    mockStreamText.mockImplementation((params) => {
      stepIdx++
      // pre-step 守卫先于模型调用运行:此时 seen[0] 即第 1 步估算
      const inputTokens = Math.round(seen[0] * actualRatio)
      return mockSingleStep(
        stepIdx === 1
          ? {
              toolCalls: [{ toolCallId: 'tc1', toolName: 'read', input: { path: 'a' } }],
              toolResults: [{ toolCallId: 'tc1', toolName: 'read', output: 'ok' }],
              usage: { inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 },
            }
          : { text: 'done', finishReason: 'stop' },
      )(params as never) as unknown as ReturnType<typeof mockStreamText>
    })
    await runReactLoop(
      makeOpts({
        pipeline: { build } as unknown as ReactLoopOptions['pipeline'],
        providerConfig: { context_limit: 1_000_000 } as ReactLoopOptions['providerConfig'],
        agent: {
          id: '__chat__',
          toolRegistry: {
            listTools: () => [],
            getToolNames: () => ['read'],
            listMcpTools: () => [],
          },
        } as unknown as ReactLoopOptions['agent'],
      }),
    )
    return seen
  }

  const step1Estimate = estimate('hello') + estimate(JSON.stringify(bigTools))
  const step2Estimate = step2Messages.reduce((sum, m) => sum + estimate(m.content), 0)

  it('scales the next estimate by the previous call’s actual/estimate ratio, so a shrinking tool set shrinks it', async () => {
    const [first, second] = await runTwoSteps(1.25)
    // (不触发)首次调用无实际值可校准:纯字符估算,且计入工具定义
    expect(first).toBe(step1Estimate)
    // 旧逻辑直接复用上次实际值(≈ first × 1.25),工具集清空后严重高估
    expect(second).toBe(Math.round(step2Estimate * 1.25))
  })

  it('clamps the calibration ratio to 2× when one call’s actual is far off its estimate', async () => {
    const [, second] = await runTwoSteps(10)
    expect(second).toBe(Math.round(step2Estimate * 2))
  })
})
