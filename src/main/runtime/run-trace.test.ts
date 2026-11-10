import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent-talor-test-home' } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))
vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))

import { memoryArchive, type Archive, type RunEvent } from 'agent-engine'
import { runToolDurations, runTraceDetail, runTraceSummaries } from './run-trace'
import { clearRowCache } from './turn-rows'

type Body = Record<string, unknown> & { t: string }

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
})

const started = (sessionId: string, parentRunId?: string, content?: string): Body => ({
  t: 'run_started',
  agent: { id: 'talor__chat__', fingerprint: 'fa' },
  task: { fingerprint: 'ft', subject: sessionId, ...(content ? { content } : {}) },
  environment: { name: 'interactive', fingerprint: 'fe', principalReachable: true },
  engine: { fingerprint: 'fg' },
  capabilities: [],
  unavailable: [],
  model: 'talor:p1/m1',
  queuedMs: 0,
  rootRunId: parentRunId ?? 'root',
  ...(parentRunId ? { parentRunId } : {}),
  schemaVersion: 1,
})

const responded = (
  step: number,
  text: string,
  calls: Array<{ id: string; name: string; input: unknown }>,
  u = usage(10, 5, 3, 2),
  startedAt = 0,
): Body => ({
  t: 'model_responded',
  step,
  startedAt,
  response: {
    text,
    toolCalls: calls,
    finishReason: calls.length ? 'tool-calls' : 'stop',
    usage: u,
    warnings: [],
    attempts: [],
  },
})

const toolFinished = (
  callId: string,
  shown: string,
  durationMs: number,
  isError = false,
  errorCode?: string,
): Body => ({
  t: 'tool_finished',
  callId,
  capability: 'builtin',
  effect: 'none',
  shown,
  isError,
  ...(errorCode ? { errorCode } : {}),
  startedAt: 0,
  durationMs,
})

const evaluated = (step: number, opinions: unknown[] = []): Body => ({
  t: 'evaluated',
  step,
  observation: {},
  opinions,
  verdict: { continue: {}, sources: [] },
})

const ended = (runId: string, status: string, code?: string): Body => ({
  t: 'run_ended',
  result: {
    runId,
    status,
    ...(code ? { code } : {}),
    model: 'talor:p1/m1',
    usage: {
      ...usage(0, 0),
      main: usage(0, 0),
      memory: usage(0, 0),
      supervision: usage(0, 0),
      children: usage(0, 0),
    },
    steps: 1,
    toolCalls: 0,
  },
})

async function append(archive: Archive, runId: string, base: number, bodies: Body[]) {
  const events = bodies.map(
    (b, i) => ({ seq: i + 1, at: base + i * 10, ...b }) as unknown as RunEvent,
  )
  await archive.append(runId, events)
}

beforeEach(() => {
  clearRowCache()
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(`
  `)
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('runTraceSummaries', () => {
  it('AC-001 lists top-level runs of the session newest first', async () => {
    const archive = memoryArchive()
    // 预览取自读模型：用户行来自本轮输入，输出取最后一条有文字的 assistant 行；不读 messages 表
    const input = await archive.putBlob(
      JSON.stringify({
        input: [{ role: 'user', parts: [{ type: 'text', text: 'x'.repeat(250) }] }],
      }),
    )
    await append(archive, 'run-a', 1_000, [
      started('s1', undefined, input),
      { t: 'step_started', step: 1 },
      { t: 'context_built', step: 1, messages: [], tools: [], estimate: 0 },
      responded(1, '答复', [{ id: 'c1', name: 'read', input: {} }]),
      toolFinished('c1', 'sha256:x', 5),
      evaluated(1),
      { t: 'step_ended', step: 1 },
      ended('run-a', 'completed'),
    ])
    await append(archive, 'run-b', 5_000, [
      started('s1'),
      { t: 'step_started', step: 1 },
      { t: 'context_built', step: 1, messages: [], tools: [], estimate: 0 },
      {
        t: 'model_failed',
        step: 1,
        startedAt: 5_000,
        error: { code: 'AUTH_FAILED', message: 'bad', retryable: false, attempts: [] },
      },
      ended('run-b', 'failed', 'AUTH_FAILED'),
    ])
    await append(archive, 'run-child', 3_000, [
      started('s1', 'run-a'),
      ended('run-child', 'completed'),
    ])

    const list = await runTraceSummaries(archive, 's1', 50)

    expect(list.map((r) => r.id)).toEqual(['run-b', 'run-a'])
    expect(list.map((r) => r.exit_reason)).toEqual(['failed:AUTH_FAILED', 'completed'])
    expect(list.map((r) => r.error_count)).toEqual([1, 0])
    const a = list[1]!
    expect(a).toMatchObject({
      name: 'engine-run',
      timestamp: new Date(1_000).toISOString(),
      generation_count: 1,
      tool_count: 1,
      observation_count: 3,
      input_preview: 'x'.repeat(200),
      output_preview: '答复',
      usage: {
        input: 10,
        output: 5,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
        output_reasoning_tokens: 0,
      },
    })
  })
})

describe('runTraceDetail', () => {
  it('AC-002 maps the run tree to observations with a prompt index', async () => {
    const archive = memoryArchive()
    const sys = JSON.stringify({ role: 'system', content: 'You are Talor.' })
    const user = JSON.stringify({ role: 'user', content: 'hi' })
    const sysRef = await archive.putBlob(sys)
    const userRef = await archive.putBlob(user)
    const shown = await archive.putBlob('<tool_output>\nERROR boom\n</tool_output>')
    await append(archive, 'run-1', 10_000, [
      started('s1'),
      { t: 'step_started', step: 1 },
      { t: 'context_built', step: 1, messages: [sysRef, userRef], tools: [], estimate: 5 },
      responded(1, '看看', [{ id: 'c1', name: 'read', input: { path: 'a' } }], usage(7, 3), 10_020),
      toolFinished('c1', shown, 12, true, 'TOOL_EXCEPTION'),
      evaluated(1, [{ source: 'guard', mode: 'active', durationMs: 1 }]),
      { t: 'step_ended', step: 1 },
      ended('run-1', 'completed'),
    ])

    const detail = (await runTraceDetail(archive, 'run-1'))!

    expect(detail.trace).toMatchObject({
      id: 'run-1',
      session_id: 's1',
      tags: ['engine'],
      metadata: { source: 'engine', exit_reason: 'completed', agent_id: 'talor__chat__' },
      environment: 'interactive',
    })
    const obs = detail.observations
    expect(obs.map((o) => o.type)).toEqual(['AGENT', 'SPAN', 'GENERATION', 'TOOL', 'GUARDRAIL'])
    expect(obs.map((o) => o.id)).toEqual(['run-1:0', 'run-1:1', 'run-1:2', 'run-1:3', 'run-1:4'])
    expect(obs.map((o) => o.parent_observation_id)).toEqual([
      null,
      'run-1:0',
      'run-1:1',
      'run-1:1',
      'run-1:1',
    ])
    const gen = obs[2]!
    expect(gen.usage_details).toEqual({
      input: 7,
      output: 3,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    expect(gen.provided_model_name).toBe('talor:p1/m1')
    expect(JSON.parse(gen.input!)).toEqual({
      messages: [
        { role: 'system', hash: sysRef, bytes: Buffer.byteLength(sys) },
        { role: 'user', hash: userRef, bytes: Buffer.byteLength(user) },
      ],
    })
    expect(JSON.parse(gen.output!)).toEqual({
      text: '看看',
      toolCalls: [{ name: 'read', input: { path: 'a' } }],
    })
    expect(gen.metadata).not.toHaveProperty('usage')
    const tool = obs[3]!
    expect(tool).toMatchObject({
      input: JSON.stringify({ path: 'a' }),
      output: 'ERROR boom',
      level: 'ERROR',
      status_message: 'TOOL_EXCEPTION',
    })
    expect(obs[4]!.level).toBe('DEBUG')
    // 详情的消息由运行事件折叠，messages 表里的行不再出现
    expect(detail.messages.map((m) => m.id)).toEqual(['run-1:u', 'run-1:s1:a', 'run-1:s1:t'])
    expect(await runTraceDetail(archive, 'missing')).toBeNull()
  })

  it('records an unreadable blob as unknown with zero bytes', async () => {
    const archive = memoryArchive()
    const missing = `sha256:${'0'.repeat(64)}`
    await append(archive, 'run-2', 0, [
      started('s1'),
      { t: 'step_started', step: 1 },
      { t: 'context_built', step: 1, messages: [missing], tools: [], estimate: 0 },
      responded(1, 'ok', []),
      evaluated(1),
      { t: 'step_ended', step: 1 },
      ended('run-2', 'completed'),
    ])
    const gen = (await runTraceDetail(archive, 'run-2'))!.observations.find(
      (o) => o.type === 'GENERATION',
    )!
    expect(JSON.parse(gen.input!).messages).toEqual([{ role: 'unknown', hash: missing, bytes: 0 }])
  })
})

describe('runToolDurations', () => {
  it('AC-003 collects tool durations of the session runs', async () => {
    const archive = memoryArchive()
    for (const [runId, callId, ms, base] of [
      ['r1', 'c1', 120, 0],
      ['r2', 'c2', 30, 1000],
    ] as const) {
      await append(archive, runId, base, [
        started('s1'),
        { t: 'step_started', step: 1 },
        { t: 'context_built', step: 1, messages: [], tools: [], estimate: 0 },
        responded(1, '', [{ id: callId, name: 'read', input: {} }]),
        toolFinished(callId, 'sha256:x', ms),
        evaluated(1),
        { t: 'step_ended', step: 1 },
        ended(runId, 'completed'),
      ])
    }
    expect(await runToolDurations(archive, 's1')).toEqual({ c1: 120, c2: 30 })
  })
})
