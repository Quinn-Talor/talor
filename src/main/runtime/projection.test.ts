import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { touch, addUsage } = vi.hoisted(() => ({
  touch: vi.fn(),
  addUsage: vi.fn(),
}))

vi.mock('../repos/session-repo', () => ({
  sessionRepo: { touch, addUsage },
}))

import type { Notice, RunEvent } from 'agent-engine'
import type { ChatCallbacks } from '../chat/types'
import { phaseMarker } from '@shared/turn-phase'
import { createProjection, toolOutputBody, usageRemainder } from './projection'

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
const wrap = (body: string) => `<tool_output>\n${body}\n</tool_output>`

function responded(
  step: number,
  text: string,
  toolCalls: Array<{ id: string; name: string; input: unknown }> = [],
  reasoning?: { text: string; providerData?: unknown },
): RunEvent {
  return {
    t: 'model_responded',
    step,
    seq: 0,
    at: 1000 + step,
    startedAt: 900,
    response: {
      text,
      ...(reasoning ? { reasoning } : {}),
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
      usage,
      warnings: [],
      attempts: [],
    },
  } as unknown as RunEvent
}

const finished = (callId: string, shown: string, isError = false, errorCode?: string) =>
  ({
    t: 'tool_finished',
    seq: 0,
    at: 0,
    callId,
    capability: 'builtin',
    effect: 'none',
    shown,
    isError,
    ...(errorCode ? { errorCode } : {}),
    startedAt: 0,
    durationMs: 7,
  }) as unknown as RunEvent

const event = (body: Record<string, unknown>) => ({ seq: 0, at: 0, ...body }) as unknown as RunEvent

type Row = {
  id: string
  role: string
  content: unknown
  trace_id?: string
  agent_id: string
  session_id: string
}

/** 每次"这一步已落库"通知时，折叠结果里新出现的行（内容解析回对象），即渲染端那次能拉到的新行。 */
let batches: Row[][] = []

function setup(blobs: Record<string, string> = {}) {
  const calls: unknown[][] = []
  const seen = new Set<string>()
  batches = []
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push([name, ...args])
  const callbacks: ChatCallbacks = {
    onTextDelta: record('delta'),
    onToolCall: record('toolCall'),
    onToolResult: record('toolResult'),
    onMessagePersisted: (...args: unknown[]) => {
      calls.push(['persisted', ...args])
      const fresh = projection
        .fold()
        .rows()
        .filter((r) => r.role !== 'user' && !seen.has(r.id))
      for (const r of fresh) seen.add(r.id)
      if (fresh.length > 0) {
        batches.push(fresh.map((r) => ({ ...r, content: JSON.parse(r.content) as unknown })))
      }
    },
    onReasoningDelta: record('reasoning'),
    onRunStatus: record('status'),
    onDone: record('done'),
  }
  const projection = createProjection({
    sessionId: 's1',
    messageId: 'run1',
    agentId: '__chat__',
    callbacks,
    getBlob: async (ref) => blobs[ref] ?? '',
  })
  const feed = async (items: Array<RunEvent | Notice>) => {
    for (const item of items) {
      if ('seq' in item) await projection.subscriber.onEvent?.(item, { runId: 'run1' })
      else projection.subscriber.onNotice?.(item, { runId: 'run1' })
    }
    await projection.idle()
  }
  return { calls, feed, projection }
}

const batchRows = (n: number) => batches[n]!

beforeEach(() => {
  batches = []
  touch.mockReset()
  addUsage.mockReset()
})

describe('createProjection', () => {
  it('AC-004 forwards a step to the renderer and persists it as one batch', async () => {
    const { calls, feed } = setup({ b1: wrap('file body') })

    await feed([
      { t: 'text_delta', step: 1, text: 'hi' },
      responded(1, 'hi', [{ id: 'c1', name: 'read', input: { path: 'a' } }], {
        text: 'think',
        providerData: { anthropic: { signature: 'sig' } },
      }),
      finished('c1', 'b1'),
      event({ t: 'step_ended', step: 1 }),
    ])

    expect(calls).toEqual([
      ['delta', 'run1', 'hi', 1],
      ['toolCall', 'run1', 'c1', 'read', { path: 'a' }, 1, 1001],
      ['toolResult', 'run1', 'c1', 'read', 'file body', 7],
      ['persisted', 's1', 1],
    ])
    expect(batches).toHaveLength(1)
    const [assistant, tool] = batchRows(0)
    expect(assistant).toMatchObject({
      role: 'assistant',
      session_id: 's1',
      agent_id: '__chat__',
      trace_id: 'run1',
      content: [
        { type: 'reasoning', text: 'think', providerOptions: { anthropic: { signature: 'sig' } } },
        { type: 'text', text: 'hi', providerOptions: phaseMarker('process') },
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'read',
          input: { path: 'a' },
          providerOptions: phaseMarker('process'),
        },
      ],
    })
    expect(tool).toMatchObject({
      role: 'tool',
      trace_id: 'run1',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'read',
          output: { type: 'text', value: wrap('file body') },
          isError: false,
        },
      ],
    })
    expect(touch).toHaveBeenCalledWith('s1')
  })

  it('AC-004 reports a failed tool result as an error envelope', async () => {
    const { calls, feed } = setup({ b2: wrap('ERROR [TOOL_FAILED]: Path not found: x') })

    await feed([
      responded(2, '', [{ id: 'c2', name: 'ls', input: {} }]),
      finished('c2', 'b2', true, 'TOOL_FAILED'),
      event({ t: 'step_ended', step: 2 }),
    ])

    expect(calls).toContainEqual([
      'toolResult',
      'run1',
      'c2',
      'ls',
      {
        __talor_error: true,
        code: 'TOOL_FAILED',
        message: 'ERROR [TOOL_FAILED]: Path not found: x',
      },
      7,
    ])
    const [assistant, tool] = batchRows(0)
    expect(assistant!.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'c2',
        toolName: 'ls',
        input: {},
        providerOptions: phaseMarker('process'),
      },
    ])
    expect(tool!.content).toMatchObject([{ isError: true }])
  })

  it('AC-005 fills a missing tool result when the run ends mid-step', async () => {
    const { calls, feed } = setup()

    await feed([
      responded(1, 'working', [{ id: 'c1', name: 'bash', input: { command: 'sleep 9' } }]),
      event({ t: 'run_ended', result: {} }),
    ])

    const [, tool] = batchRows(0)
    const [part] = tool!.content as Array<{ output: { value: string }; isError: boolean }>
    expect(part!.isError).toBe(true)
    expect(part!.output.value).toContain('TOOL_MISSING_RESULT')
    expect(calls).toContainEqual(['persisted', 's1', 1])
  })

  it('AC-005 persists the partial text of an aborted model call', async () => {
    const { feed } = setup()

    await feed([
      event({ t: 'model_aborted', step: 1, partialText: 'par' }),
      event({ t: 'run_ended', result: {} }),
    ])

    expect(batchRows(0)).toHaveLength(1)
    expect(batchRows(0)[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'par' }],
    })
  })

  it('AC-005 streams and persists the fallback text after the last step', async () => {
    const { calls, feed } = setup()

    await feed([
      responded(1, 'step one'),
      event({ t: 'step_ended', step: 1 }),
      event({ t: 'fallback_generated', code: 'max_steps', text: '总结', degradation: 1 }),
      event({ t: 'run_ended', result: {} }),
    ])

    expect(calls).toContainEqual(['delta', 'run1', '总结', 2])
    expect(calls.at(-1)).toEqual(['persisted', 's1', 2])
    expect(batchRows(1)[0]).toMatchObject({ content: [{ type: 'text', text: '总结' }] })
  })

  it('skips empty steps', async () => {
    const { calls, feed } = setup()

    await feed([responded(1, ''), event({ t: 'step_ended', step: 1 })])

    expect(batches).toEqual([])
    expect(calls.filter((c) => c[0] === 'persisted')).toEqual([])
  })
})

const evaluated = (step: number, verdict: Record<string, unknown>) =>
  event({
    t: 'evaluated',
    step,
    observation: {},
    opinions: [],
    verdict: { ...verdict, sources: [] },
  })
const delivered = (step: number, outcome: string) =>
  event({
    t: 'delivery_checked',
    step,
    path: 'normal',
    attempt: 1,
    output: { ok: true },
    checks: [],
    outcome,
  })
const contentOf = (n: number) => batchRows(n)[0]!.content as Array<Record<string, unknown>>

describe('turn phases (C1)', () => {
  it('AC-001 marks a step with tool calls as process on text and tool-call parts', async () => {
    const { feed } = setup({ b1: wrap('x') })
    await feed([
      responded(1, '先看看', [{ id: 'c1', name: 'read', input: {} }], { text: '想' }),
      evaluated(1, { continue: {} }),
      finished('c1', 'b1'),
      event({ t: 'step_ended', step: 1 }),
    ])
    expect(contentOf(0)).toEqual([
      { type: 'reasoning', text: '想' },
      { type: 'text', text: '先看看', providerOptions: phaseMarker('process') },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'read',
        input: {},
        providerOptions: phaseMarker('process'),
      },
    ])
    expect(batchRows(0)[1]!.role).toBe('tool')
  })

  it('AC-002 holds a completed text step until delivery and shows verifying meanwhile', async () => {
    const { calls, feed } = setup()
    await feed([
      responded(1, '答复'),
      evaluated(1, { complete: true }),
      event({ t: 'step_ended', step: 1 }),
    ])
    expect(batches).toEqual([])
    expect(calls).toContainEqual(['status', 'run1', 'verifying'])

    await feed([delivered(1, 'delivered')])
    expect(contentOf(0)).toEqual([
      { type: 'text', text: '答复', providerOptions: phaseMarker('answer') },
    ])
    expect(calls.slice(-2)).toEqual([
      ['status', 'run1', 'idle'],
      ['persisted', 's1', 1],
    ])
  })

  it('AC-003 marks returned and fallback steps as process, failed and stopped as answer', async () => {
    const phases: unknown[] = []
    for (const outcome of ['returned', 'fallback', 'failed', 'stopped']) {
      const { calls, feed } = setup()
      await feed([
        responded(1, '答复'),
        evaluated(1, { complete: true }),
        event({ t: 'step_ended', step: 1 }),
        delivered(1, outcome),
      ])
      phases.push(contentOf(0)[0]!.providerOptions)
      expect(calls).toContainEqual(['status', 'run1', 'idle'])
    }
    expect(phases).toEqual([
      phaseMarker('process'),
      phaseMarker('process'),
      phaseMarker('answer'),
      phaseMarker('answer'),
    ])
  })

  it('AC-004 classifies text steps by verdict and persists a pending step at run end', async () => {
    const phases: unknown[] = []
    for (const verdict of [
      { continue: {} },
      { finalize: { code: 'x' } },
      { awaitInput: { code: 'x' } },
      { stop: { code: 'x', message: 'm' } },
    ]) {
      const { feed } = setup()
      await feed([responded(1, 't'), evaluated(1, verdict), event({ t: 'step_ended', step: 1 })])
      phases.push(contentOf(0)[0]!.providerOptions)
    }
    expect(phases).toEqual([
      phaseMarker('process'),
      phaseMarker('process'),
      phaseMarker('answer'),
      phaseMarker('answer'),
    ])

    const { calls, feed } = setup()
    await feed([
      responded(1, '答复'),
      evaluated(1, { complete: true }),
      event({ t: 'step_ended', step: 1 }),
      event({ t: 'run_ended', result: {} }),
    ])
    expect(contentOf(0)).toEqual([
      { type: 'text', text: '答复', providerOptions: phaseMarker('answer') },
    ])
    expect(calls).toContainEqual(['status', 'run1', 'idle'])

    const fallback = setup()
    await fallback.feed([
      event({ t: 'fallback_generated', code: 'x', text: '总结', degradation: 1 }),
    ])
    expect(contentOf(0)).toEqual([
      { type: 'text', text: '总结', providerOptions: phaseMarker('answer') },
    ])
  })

  it('AC-005 forwards reasoning deltas and tolerates callbacks without the new methods', async () => {
    const { calls, feed } = setup()
    await feed([{ t: 'reasoning_delta', step: 2, text: '想' } as Notice])
    expect(calls).toEqual([['reasoning', 'run1', '想', 2]])

    const bare = createProjection({
      sessionId: 's1',
      messageId: 'run1',
      agentId: '__chat__',
      callbacks: {
        onTextDelta: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onDone: vi.fn(),
      },
      getBlob: async () => '',
    })
    bare.subscriber.onNotice?.({ t: 'reasoning_delta', step: 1, text: 'x' }, { runId: 'run1' })
    for (const e of [
      responded(1, 'a'),
      evaluated(1, { complete: true }),
      event({ t: 'step_ended', step: 1 }),
      delivered(1, 'delivered'),
    ]) {
      await bare.subscriber.onEvent?.(e, { runId: 'run1' })
    }
    await bare.idle()
    expect(bare.fold().rows()).toHaveLength(1)
  })

  it('logs a delivery result that has no pending step and persists nothing', async () => {
    const { feed } = setup()
    await feed([delivered(1, 'delivered')])
    expect(batches).toEqual([])
  })
})

describe('toolOutputBody', () => {
  it('strips the wrapper and restores escaped closing tags', () => {
    expect(toolOutputBody(wrap('a <\\/tool_output> b'))).toBe('a </tool_output> b')
    expect(toolOutputBody('plain')).toBe('plain')
  })
})

describe('per-step usage (A5b)', () => {
  const withUsage = (e: RunEvent, u: Record<string, number>) => {
    ;(e as unknown as { response: { usage: unknown } }).response.usage = u
    return e
  }
  const tokens = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
    input,
    output,
    cacheRead,
    cacheWrite,
  })
  const external = (kind: string, u?: Record<string, number>) =>
    event({
      t: 'external_call',
      source: 'memory',
      kind,
      request: 'r',
      response: 'r',
      ...(u ? { usage: u } : {}),
      startedAt: 0,
      durationMs: 1,
    })

  it('AC-001 records main and model external usage per step, and nothing else', async () => {
    const first = setup({ b1: wrap('x') })
    const second = setup()
    await first.feed([
      withUsage(responded(1, '', [{ id: 'c1', name: 'delegate', input: {} }]), tokens(10, 5, 2)),
      external('model', tokens(3, 0)),
      external('hook', tokens(50, 50)),
      {
        ...(finished('c1', 'b1') as unknown as Record<string, unknown>),
        usage: tokens(100, 0),
      } as unknown as RunEvent,
      event({ t: 'step_ended', step: 1 }),
      withUsage(responded(2, 'done'), tokens(20, 7)),
    ])
    const seen = addUsage.mock.calls.map((c) => c[1])
    expect(seen).toEqual([
      { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 0 },
      { inputTokens: 3, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { inputTokens: 20, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
    expect(addUsage.mock.calls.every((c) => c[0] === 's1')).toBe(true)
    expect(first.projection.recordedUsage()).toEqual(tokens(33, 12, 2))

    await second.feed([withUsage(responded(2, 'done'), tokens(20, 7))])
    expect(second.projection.recordedUsage()).toEqual(tokens(20, 7))
    expect(first.projection.recordedUsage()).toEqual(tokens(33, 12, 2))
  })

  it('AC-001 skips a step whose usage is all zero', async () => {
    const { feed, projection } = setup()
    await feed([withUsage(responded(1, 'hi'), tokens(0, 0))])
    expect(addUsage).not.toHaveBeenCalled()
    expect(projection.recordedUsage()).toEqual(tokens(0, 0))
  })

  it('usageRemainder subtracts field by field and never goes below zero', () => {
    expect(usageRemainder(tokens(10, 5, 3, 1), tokens(4, 9, 3, 0))).toEqual(tokens(6, 0, 0, 1))
  })
})

describe('intent steps (C2)', () => {
  it('AC-003 treats an intent-only step as a text step and a mixed step as process', async () => {
    const { calls, feed } = setup({
      b1: wrap('已记录'),
      b2: wrap('问题已发送给委托人'),
      b3: wrap('x'),
    })
    await feed([
      responded(1, '', [{ id: 'f1', name: 'finish', input: { summary: '完成' } }]),
      evaluated(1, { complete: true }),
      finished('f1', 'b1'),
      event({ t: 'step_ended', step: 1 }),
    ])
    expect(batches).toEqual([])
    expect(calls).toContainEqual(['status', 'run1', 'verifying'])
    await feed([delivered(1, 'delivered')])
    expect(contentOf(0)).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'f1',
        toolName: 'finish',
        input: { summary: '完成' },
        providerOptions: phaseMarker('answer'),
      },
    ])
    expect(batchRows(0)[1]).toMatchObject({ role: 'tool' })
    expect(JSON.stringify(batchRows(0)[1]!.content)).toContain('已记录')

    const ask = setup({ b2: wrap('问题已发送给委托人') })
    await ask.feed([
      responded(1, '', [{ id: 'a1', name: 'ask_user', input: { question: 'q' } }]),
      evaluated(1, { awaitInput: { code: 'ask_user' } }),
      finished('a1', 'b2'),
      event({ t: 'step_ended', step: 1 }),
    ])
    expect(batches).toHaveLength(1)
    expect(contentOf(0)[0]!.providerOptions).toEqual(phaseMarker('answer'))

    const mixed = setup({ b2: wrap('q'), b3: wrap('x') })
    await mixed.feed([
      responded(1, '', [
        { id: 'a1', name: 'ask_user', input: { question: 'q' } },
        { id: 'r1', name: 'read', input: {} },
      ]),
      evaluated(1, { continue: {} }),
      finished('a1', 'b2'),
      finished('r1', 'b3'),
      event({ t: 'step_ended', step: 1 }),
    ])
    expect(contentOf(0).map((p) => p.providerOptions)).toEqual([
      phaseMarker('process'),
      phaseMarker('process'),
    ])
  })
})
