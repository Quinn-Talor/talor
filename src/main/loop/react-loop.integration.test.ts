// react-loop 集成测试（turn-trace AC-022）：真实 streamText + MockLanguageModelV4（经 wrapModel）
// + 真实 buildTools / reflector / policy + :memory: SQLite。证明一轮的 trace 完整（不变量为空）
// 且 session 用量与 GENERATION 用量逐桶相等。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { DEFAULT_TRACE_CONFIG } from '@shared/types/trace'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index')>()
  return {
    ...actual,
    getDb: () => {
      if (!currentDb.instance) throw new Error('Test DB not initialized')
      return currentDb.instance
    },
  }
})

import { ensureMessagesTraceColumn, initTraceTables } from '../db/index'
import { runReactLoop } from './react-loop'
import type { ReactLoopOptions } from './types'
import { wrapModel } from '../providers/middleware'
import { traceRecorder } from '../observe/trace-recorder'
import { runInScope } from '../observe/trace-context'
import { verifyTraceInvariants } from '../observe/trace-invariants'
import { traceRepo } from '../repos/trace-repo'
import type { ToolMetadata } from '../tools/types'

const SESSION = 's-int'
const TRACE = 't-int'

const ECHO: ToolMetadata = {
  name: 'echo',
  description: 'echo input',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  riskLevel: 'LOW',
}

const USAGE = {
  inputTokens: { total: 10, noCache: 7, cacheRead: 3, cacheWrite: 0 },
  outputTokens: { total: 7, text: 5, reasoning: 2 },
}

function toolCallStream() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start' as const, warnings: [] },
        {
          type: 'tool-call' as const,
          toolCallId: 'call-1',
          toolName: 'echo',
          input: '{"text":"hi"}',
        },
        {
          type: 'finish' as const,
          usage: USAGE,
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
        },
      ],
    }),
  }
}

function textStream() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start' as const, warnings: [] },
        { type: 'text-start' as const, id: 'txt' },
        { type: 'text-delta' as const, id: 'txt', delta: 'done' },
        { type: 'text-end' as const, id: 'txt' },
        {
          type: 'finish' as const,
          usage: USAGE,
          finishReason: { unified: 'stop' as const, raw: 'stop' },
        },
      ],
    }),
  }
}

function makeOpts(): ReactLoopOptions {
  const model = wrapModel(
    new MockLanguageModelV4({
      modelId: 'mock-model',
      doStream: [toolCallStream(), textStream()],
      // reflect agent(若被触发)拿到无法通过 schema 的 JSON → 返回 null,不改变流程
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{}' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: USAGE,
        warnings: [],
      }),
    }),
    undefined,
  )
  return {
    model,
    sessionId: SESSION,
    messageId: TRACE,
    userContent: 'say hi with echo',
    mappedAttachments: [],
    abortSignal: new AbortController().signal,
    pipeline: {
      build: vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'say hi with echo' }],
        tools: [ECHO],
        degraded: [],
      }),
    } as unknown as ReactLoopOptions['pipeline'],
    provider: { id: 'p1', name: 'test-provider', type: 'openai' } as ReactLoopOptions['provider'],
    providerConfig: {} as ReactLoopOptions['providerConfig'],
    workspace: '',
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
        listTools: () => [ECHO],
        execute: vi.fn(async () => ({ output: 'echoed: hi' })),
        getToolNames: () => ['echo'],
        listMcpTools: () => [],
      },
    } as unknown as ReactLoopOptions['agent'],
    confirmTool: vi.fn(async () => true),
    skillTracker: {
      activate: vi.fn(),
      clear: vi.fn(),
    } as unknown as ReactLoopOptions['skillTracker'],
    events: { on: vi.fn(), emit: vi.fn() } as unknown as ReactLoopOptions['events'],
  } as unknown as ReactLoopOptions
}

beforeEach(() => {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  d.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT,
      workspace TEXT, agent_id TEXT NOT NULL DEFAULT '__chat__', parent_session_id TEXT,
      parent_message_id TEXT, status TEXT NOT NULL DEFAULT 'completed', metadata TEXT,
      reasoning TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'blocks', agent_id TEXT NOT NULL DEFAULT '__chat__',
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `)
  initTraceTables(d)
  ensureMessagesTraceColumn(d)
  d.prepare(
    `INSERT INTO sessions (id, title, provider_id, created_at, updated_at) VALUES (?, 'int', 'p1', ?, ?)`,
  ).run(SESSION, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z')
  currentDb.instance = d
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('react-loop integration — turn trace', () => {
  it('AC-022: a real two-step turn leaves a complete trace whose usage matches the session totals', async () => {
    const opts = makeOpts()
    const scope = traceRecorder.startTrace({
      id: TRACE,
      sessionId: SESSION,
      name: 'turn',
      input: opts.userContent,
      rootName: 'agent:__chat__',
      config: DEFAULT_TRACE_CONFIG,
    })
    const result = await runInScope(scope, () => runReactLoop(opts))
    traceRecorder.endTrace(TRACE, { metadata: { exit_reason: result.exitReason } })

    expect(result.totalSteps).toBe(2)
    expect(result.totalToolCalls).toBe(1)
    expect(verifyTraceInvariants(TRACE, [SESSION])).toEqual([])

    const observations = traceRepo.listObservations(TRACE)
    const generations = observations.filter((o) => o.type === 'GENERATION' && o.level !== 'ERROR')
    const sum = (key: string) =>
      generations.reduce((acc, g) => acc + (g.usage_details?.[key] ?? 0), 0)
    const session = currentDb
      .instance!.prepare(
        'SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM sessions WHERE id = ?',
      )
      .get(SESSION) as Record<string, number>
    expect(generations.length).toBeGreaterThanOrEqual(2)
    expect(session.input_tokens).toBe(sum('input'))
    expect(session.cache_read_tokens).toBe(sum('cache_read_input_tokens'))
    expect(session.cache_write_tokens).toBe(sum('cache_creation_input_tokens'))
    expect(session.output_tokens).toBe(sum('output') + sum('output_reasoning_tokens'))

    const types = new Set(observations.map((o) => o.type))
    for (const t of ['AGENT', 'CHAIN', 'SPAN', 'GENERATION', 'TOOL', 'GUARDRAIL', 'EVALUATOR']) {
      expect(types.has(t as never)).toBe(true)
    }
    const tool = observations.find((o) => o.type === 'TOOL')!
    expect(tool.metadata.tool_call_id).toBe('call-1')
    expect(tool.output).toBe('echoed: hi')
  })
})
