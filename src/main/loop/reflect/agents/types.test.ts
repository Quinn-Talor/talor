import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }))
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateObject: (...args: unknown[]) => mockGenerateObject(...args) }
})

import { runReflectAgent, type ReflectAgent } from './types'

const Schema = z.object({ value: z.string() })
type Result = z.infer<typeof Schema>

interface Snapshot {
  input: string
}

const TestAgent: ReflectAgent<Snapshot, Result> = {
  name: 'test-agent',
  schema: Schema,
  systemPrompt: 'You are a test.',
  buildUserPrompt: (s) => `Input: ${s.input}`,
  maxOutputTokens: 100,
  timeoutMs: 5_000,
}

describe('runReflectAgent', () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
  })

  it('成功返结构化结果', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { value: 'ok' } })
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out).toEqual({ value: 'ok' })
  })

  it('调用参数: system + user + schema + maxOutputTokens', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { value: 'ok' } })
    await runReflectAgent(TestAgent, { input: 'hello' }, {} as never, new AbortController().signal)
    const callArgs = mockGenerateObject.mock.calls[0][0] as {
      messages: { role: string; content: string }[]
      maxOutputTokens: number
    }
    expect(callArgs.messages[0].role).toBe('system')
    expect(callArgs.messages[0].content).toBe('You are a test.')
    expect(callArgs.messages[1].role).toBe('user')
    expect(callArgs.messages[1].content).toBe('Input: hello')
    expect(callArgs.maxOutputTokens).toBe(100)
  })

  it('失败返 null (静默)', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('boom'))
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out).toBeNull()
  })

  it('abort signal 透传 + 默认 timeout', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { value: 'ok' } })
    const ac = new AbortController()
    await runReflectAgent(TestAgent, { input: 'x' }, {} as never, ac.signal)
    const callArgs = mockGenerateObject.mock.calls[0][0] as { abortSignal: AbortSignal }
    expect(callArgs.abortSignal).toBeDefined()
  })
})
