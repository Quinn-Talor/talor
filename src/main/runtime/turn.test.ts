import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet }) },
}))

import type { RunResult, RunSummary } from '@talor/agent-engine'
import { chatErrorOf, rulesChangedSince } from './turn'

const resultOf = (patch: Partial<RunResult>) =>
  ({ runId: 'r', status: 'completed', ...patch }) as RunResult

describe('chatErrorOf', () => {
  it('AC-006 maps failed runs by their model error code', () => {
    const failed = (code: string) =>
      chatErrorOf(
        resultOf({ status: 'failed', error: { code, message: `m-${code}`, retryable: false } }),
      )
    expect(failed('AUTH_FAILED')).toEqual({ code: 'AUTH_FAILED', message: 'm-AUTH_FAILED' })
    expect(failed('RATE_LIMITED')?.code).toBe('RATE_LIMITED')
    expect(failed('MODEL_TIMEOUT')?.code).toBe('LLM_TIMEOUT')
    expect(failed('MODEL_CONNECTION')?.code).toBe('LLM_CONNECTION_FAILED')
    expect(failed('MODEL_ERROR')?.code).toBe('LLM_ERROR')
    expect(failed('model_unsuitable')?.code).toBe('MODEL_INPUT_UNSUPPORTED')
    expect(chatErrorOf(resultOf({ status: 'failed', code: 'engine_error' }))).toEqual({
      code: 'LLM_ERROR',
      message: 'engine_error',
    })
  })

  it('B2 AC-006 reports the reason a hook gave for blocking the run', () => {
    expect(
      chatErrorOf(
        resultOf({ status: 'stopped', code: 'notice_blocked', text: 'blocked by policy' }),
      ),
    ).toEqual({ code: 'LLM_ERROR', message: 'blocked by policy' })
    expect(chatErrorOf(resultOf({ status: 'stopped', code: 'notice_blocked' }))?.message).toBe(
      'hook 拦下了这次运行',
    )
  })

  it('AC-006 reports a stopped run and stays silent otherwise', () => {
    const stopped = chatErrorOf(resultOf({ status: 'stopped', code: 'budget' }))
    expect(stopped?.code).toBe('LLM_ERROR')
    expect(stopped?.message).toContain('budget')
    for (const status of ['aborted', 'completed', 'finalized', 'awaiting_input'] as const) {
      expect(chatErrorOf(resultOf({ status }))).toBeUndefined()
    }
  })

  it('C2 AC-002 stays silent for report_blocked and awaiting input, reports other stops', () => {
    expect(
      chatErrorOf(
        resultOf({
          status: 'stopped',
          code: 'blocked',
          intent: { tool: 'report_blocked', input: { reason: '缺少权限' } },
        }),
      ),
    ).toBeUndefined()
    expect(chatErrorOf(resultOf({ status: 'stopped', code: 'budget' }))).toMatchObject({
      code: 'LLM_ERROR',
    })
    expect(
      chatErrorOf(
        resultOf({
          status: 'awaiting_input',
          intent: { tool: 'ask_user', input: { question: 'q' } },
        }),
      ),
    ).toBeUndefined()
  })
})

describe('rulesChangedSince', () => {
  const run = (patch: Partial<RunSummary>) =>
    ({ runId: 'r', environmentFingerprint: 'fp-old', startedAt: 1, ...patch }) as RunSummary
  const archiveOf = (runs: RunSummary[]) => {
    const filters: unknown[] = []
    return {
      filters,
      query: async (filter: { limit?: number }) => {
        filters.push(filter)
        return runs.slice(0, filter.limit)
      },
    }
  }

  it('compares the latest turn of the session with the current environment', async () => {
    // 按会话查询只返回轮（子运行不带会话），按开始时间倒序
    const runs = [run({ runId: 'r2', environmentFingerprint: 'fp-old' }), run({ runId: 'r1' })]
    const archive = archiveOf(runs)
    expect(await rulesChangedSince(archive, 's1', 'fp-new')).toBe(true)
    expect(await rulesChangedSince(archive, 's1', 'fp-old')).toBe(false)
    expect(archive.filters[0]).toEqual({ session: 's1', limit: 1 })
  })

  it('is false for the first turn and when the archive cannot be read', async () => {
    expect(await rulesChangedSince(archiveOf([]), 's1', 'fp')).toBe(false)
    const broken = {
      query: async () => {
        throw new Error('archive closed')
      },
    }
    expect(await rulesChangedSince(broken, 's1', 'fp')).toBe(false)
  })
})
