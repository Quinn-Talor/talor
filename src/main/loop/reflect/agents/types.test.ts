import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }))
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateText: (...args: unknown[]) => mockGenerateText(...args) }
})

import { runReflectAgent, type ReflectAgent } from './types'

const Schema = z.object({ value: z.string(), confidence: z.number() })
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
    mockGenerateText.mockReset()
  })

  it('成功 JSON 输出 → 解析 + schema 校验返结果', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"value":"ok","confidence":0.8}' })
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out).toEqual({ value: 'ok', confidence: 0.8 })
  })

  it('剥离 ```json fence', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '```json\n{"value":"ok","confidence":0.5}\n```',
    })
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out?.value).toBe('ok')
  })

  it('剥离纯 ``` fence (无 json 标记)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '```\n{"value":"ok","confidence":0.5}\n```',
    })
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out?.value).toBe('ok')
  })

  it('调用参数: system 含 JSON instruction + user prompt + maxOutputTokens', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"value":"ok","confidence":0.5}' })
    await runReflectAgent(TestAgent, { input: 'hello' }, {} as never, new AbortController().signal)
    const callArgs = mockGenerateText.mock.calls[0][0] as {
      messages: { role: string; content: string }[]
      maxOutputTokens: number
    }
    expect(callArgs.messages[0].role).toBe('system')
    expect(callArgs.messages[0].content).toContain('You are a test.')
    expect(callArgs.messages[0].content).toContain('Respond ONLY with a valid JSON')
    expect(callArgs.messages[1].role).toBe('user')
    expect(callArgs.messages[1].content).toBe('Input: hello')
    expect(callArgs.maxOutputTokens).toBe(100)
  })

  it('JSON 解析失败 → null', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'not valid json' })
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out).toBeNull()
  })

  it('schema 校验失败 → null', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"value":"ok"}' }) // 缺 confidence
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out).toBeNull()
  })

  it('LLM 调用抛错 → null', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('boom'))
    const out = await runReflectAgent(
      TestAgent,
      { input: 'x' },
      {} as never,
      new AbortController().signal,
    )
    expect(out).toBeNull()
  })

  it('abort signal 透传', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"value":"ok","confidence":0.5}' })
    const ac = new AbortController()
    await runReflectAgent(TestAgent, { input: 'x' }, {} as never, ac.signal)
    const callArgs = mockGenerateText.mock.calls[0][0] as { abortSignal: AbortSignal }
    expect(callArgs.abortSignal).toBeDefined()
  })
})
