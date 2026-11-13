// trace IPC 只读引擎运行档案（D2 AC-007，原 C3 AC-004 / AC-005）：运行档案为 memoryArchive。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockHandle, archiveState, getRuntime, runArchive } = vi.hoisted(() => {
  const archiveState = { path: '', archive: null as unknown }
  return {
    mockHandle: vi.fn(),
    archiveState,
    getRuntime: vi.fn(),
    runArchive: vi.fn(() => archiveState.archive),
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))
vi.mock('../runtime/run-archive', () => ({
  runsDbPath: () => archiveState.path,
  runArchive: () => runArchive(),
}))
vi.mock('../runtime/engine', () => ({ getRuntime }))

import { memoryArchive, type Archive, type RunEvent } from '@talor/agent-engine'
import { registerTraceHandlers } from './trace'

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`handler not registered for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }

async function engineRun(archive: Archive, runId: string, at: number, blob: string) {
  const bodies: Array<Record<string, unknown>> = [
    {
      t: 'run_started',
      agent: { id: 'a', fingerprint: 'f' },
      task: { fingerprint: 'f', subject: 's1' },
      environment: { name: 'interactive', fingerprint: 'f', principalReachable: true },
      engine: { fingerprint: 'f' },
      capabilities: [],
      unavailable: [],
      model: 'talor:p1/m1',
      queuedMs: 0,
      rootRunId: runId,
      schemaVersion: 1,
    },
    { t: 'step_started', step: 1 },
    { t: 'context_built', step: 1, messages: [blob], tools: [], estimate: 1 },
    {
      t: 'model_responded',
      step: 1,
      startedAt: at,
      response: {
        text: '',
        toolCalls: [{ id: 'c-new', name: 'read', input: {} }],
        finishReason: 'tool-calls',
        usage,
        warnings: [],
        attempts: [],
      },
    },
    {
      t: 'tool_finished',
      callId: 'c-new',
      capability: 'builtin',
      effect: 'none',
      shown: blob,
      isError: false,
      startedAt: at,
      durationMs: 45,
    },
    {
      t: 'evaluated',
      step: 1,
      observation: {},
      opinions: [],
      verdict: { continue: {}, sources: [] },
    },
    { t: 'step_ended', step: 1 },
    {
      t: 'run_ended',
      result: { runId, status: 'completed', model: 'talor:p1/m1', usage, steps: 1, toolCalls: 1 },
    },
  ]
  await archive.append(
    runId,
    bodies.map((b, i) => ({ seq: i + 1, at: at + i, ...b }) as unknown as RunEvent),
  )
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'talor-trace-engine-'))
  archiveState.path = join(dir, 'runs.db')
  archiveState.archive = memoryArchive()
  runArchive.mockClear()
  getRuntime.mockClear()
  mockHandle.mockClear()
  registerTraceHandlers()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('trace IPC with the engine archive', () => {
  it('AC-007 answers the four channels from the run archive only', async () => {
    writeFileSync(archiveState.path, '')
    const archive = archiveState.archive as Archive
    const blob = await archive.putBlob(JSON.stringify({ role: 'user', content: 'hi' }))
    await engineRun(archive, 'run-old', Date.parse('2026-10-19T10:00:00.000Z'), blob)
    await engineRun(archive, 'run-new', Date.parse('2026-10-20T10:00:00.000Z'), blob)

    const list = (await handler('trace:list')({}, { session_id: 's1' })) as {
      status: string
      traces: Array<{ id: string }>
    }
    expect(list).toMatchObject({ status: 'success' })
    expect(list.traces.map((t) => t.id)).toEqual(['run-new', 'run-old'])

    const got = (await handler('trace:get')({}, { trace_id: 'run-new' })) as {
      status: string
      trace: { metadata: Record<string, unknown> }
    }
    expect(got.status).toBe('success')
    expect(got.trace.metadata.source).toBe('engine')
    expect(await handler('trace:get')({}, { trace_id: 't-old' })).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_NOT_FOUND',
    })

    expect(await handler('trace:blob:get')({}, { trace_id: 'run-new', hash: blob })).toEqual({
      status: 'success',
      content: JSON.stringify({ role: 'user', content: 'hi' }),
    })
    expect(
      await handler('trace:blob:get')(
        {},
        { trace_id: 'run-new', hash: `sha256:${'1'.repeat(64)}` },
      ),
    ).toMatchObject({ status: 'failure', error_code: 'TRACE_NOT_FOUND' })

    expect(await handler('trace:tool-durations')({}, { session_id: 's1' })).toEqual({
      status: 'success',
      durations: { 'c-new': 45 },
    })
    expect(mockHandle.mock.calls.map((c) => c[0]).sort()).toEqual([
      'trace:blob:get',
      'trace:get',
      'trace:list',
      'trace:tool-durations',
    ])
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('AC-007 gives empty results and creates no runs.db when the archive file is missing', async () => {
    expect(await handler('trace:list')({}, { session_id: 's1' })).toEqual({
      status: 'success',
      traces: [],
    })
    expect(await handler('trace:get')({}, { trace_id: 'x' })).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_NOT_FOUND',
    })
    expect(await handler('trace:blob:get')({}, { trace_id: 'x', hash: 'h' })).toMatchObject({
      error_code: 'TRACE_NOT_FOUND',
    })
    expect(await handler('trace:tool-durations')({}, { session_id: 's1' })).toEqual({
      status: 'success',
      durations: {},
    })
    expect(existsSync(archiveState.path)).toBe(false)
    expect(runArchive).not.toHaveBeenCalled()
    expect(getRuntime).not.toHaveBeenCalled()
  })

  it('maps archive read errors to TRACE_READ_FAILED', async () => {
    writeFileSync(archiveState.path, '')
    const broken = memoryArchive()
    broken.query = async () => {
      throw new Error('locked')
    }
    broken.read = () => {
      throw new Error('locked')
    }
    archiveState.archive = broken
    expect(await handler('trace:list')({}, { session_id: 's1' })).toMatchObject({
      error_code: 'TRACE_READ_FAILED',
    })
    expect(await handler('trace:get')({}, { trace_id: 'x' })).toMatchObject({
      error_code: 'TRACE_READ_FAILED',
    })
  })
})
