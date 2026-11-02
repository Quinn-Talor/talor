import { describe, it, expect, vi } from 'vitest'

const { logFns } = vi.hoisted(() => ({
  logFns: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('electron-log', () => ({ default: logFns }))

import { fakeModel, memoryArchive, modelHub, type FakeReply } from 'agent-engine'
import { electronLogger } from './logger'
import { addTool, isSmokePassed, runEngineSmoke } from './smoke'

function smokeWith(replies: FakeReply[]) {
  const model = fakeModel({ replies, repeatLast: true })
  return runEngineSmoke({
    models: modelHub({ providers: [model], default: model.ref }),
    archive: memoryArchive(),
  })
}

describe('runEngineSmoke', () => {
  it('AC-001 completes a run that calls add and archives it', async () => {
    const result = await smokeWith([
      { toolCalls: [{ name: 'add', input: { a: 17, b: 25 } }] },
      { text: '42' },
    ])

    expect(result.status).toBe('completed')
    expect(result.toolCalls).toBe(1)
    expect(result.text).toContain('42')
    expect(result.invariantViolations).toEqual([])
    expect(result.archivedRuns).toBe(1)
    expect(isSmokePassed(result)).toBe(true)
  })

  it('AC-002 reports a model auth failure as a failed run instead of throwing', async () => {
    const result = await smokeWith([{ error: { code: 'AUTH_FAILED', message: 'bad key' } }])

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('AUTH_FAILED')
    expect(result.toolCalls).toBe(0)
    expect(result.invariantViolations).toEqual([])
    expect(isSmokePassed(result)).toBe(false)
  })

  it('aborts the run when the caller cancels while the model is still answering', async () => {
    const model = fakeModel({ replies: [{ hang: true }] })
    const controller = new AbortController()
    const pending = runEngineSmoke({
      models: modelHub({ providers: [model], default: model.ref }),
      archive: memoryArchive(),
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)

    const result = await pending
    expect(result.status).toBe('aborted')
    expect(result.invariantViolations).toEqual([])
  })
})

describe('isSmokePassed', () => {
  const passed = {
    status: 'completed' as const,
    toolCalls: 1,
    invariantViolations: [],
    archivedRuns: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  }

  it('accepts a completed run with a tool call and no violations', () => {
    expect(isSmokePassed(passed)).toBe(true)
  })

  it('rejects a run without tool calls or with invariant violations', () => {
    expect(isSmokePassed({ ...passed, toolCalls: 0 })).toBe(false)
    expect(isSmokePassed({ ...passed, invariantViolations: ['I1: x'] })).toBe(false)
  })
})

describe('addTool', () => {
  it('adds two numbers', async () => {
    const out = await addTool.execute({ a: 17, b: 25 }, {} as Parameters<typeof addTool.execute>[1])
    expect(out).toBe('42')
  })
})

describe('electronLogger', () => {
  it('writes engine log entries to electron-log at their level', () => {
    const logger = electronLogger()
    logger.log({ level: 'warn', message: 'guard failed', detail: { id: 'g' } })
    logger.log({ level: 'info', message: 'run started' })

    expect(logFns.warn).toHaveBeenCalledWith('[engine]', 'guard failed', { id: 'g' })
    expect(logFns.info).toHaveBeenCalledWith('[engine]', 'run started')
  })
})
