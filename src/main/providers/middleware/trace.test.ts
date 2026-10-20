// traceMiddleware 单测：真实 streamText / generateText + MockLanguageModelV4，
// 证明 AsyncLocalStorage 能穿过 SDK 内部，并断言落库的 GENERATION。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { APICallError, generateText, simulateReadableStream, streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { DEFAULT_TRACE_CONFIG } from '@shared/types/trace'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../../db/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/index')>()
  return {
    ...actual,
    getDb: () => {
      if (!currentDb.instance) throw new Error('Test DB not initialized')
      return currentDb.instance
    },
  }
})

import { initTraceTables } from '../../db/index'
import { traceRepo } from '../../repos/trace-repo'
import { runInScope, withGenerationName } from '../../observe/trace-context'
import { traceRecorder } from '../../observe/trace-recorder'
import { wrapModel } from './index'
import { toUsageDetails } from './trace'

const USAGE = {
  inputTokens: { total: 10, noCache: 7, cacheRead: 3, cacheWrite: 0 },
  outputTokens: { total: 7, text: 5, reasoning: 2 },
}

function streamResult() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start' as const, warnings: [] },
        { type: 'text-start' as const, id: 'txt' },
        { type: 'text-delta' as const, id: 'txt', delta: 'hi' },
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

function start(id: string) {
  return traceRecorder.startTrace({
    id,
    sessionId: 's-1',
    name: 'turn',
    input: 'hi',
    rootName: 'agent:test',
    config: DEFAULT_TRACE_CONFIG,
  })!
}

function generations(traceId: string) {
  return traceRepo.listObservations(traceId).filter((o) => o.type === 'GENERATION')
}

/** 在 trace + step scope 内执行 fn，返回 step observation id。 */
async function inStep(traceId: string, fn: () => Promise<void>): Promise<string> {
  let stepId = ''
  await runInScope(start(traceId), async () => {
    await traceRecorder.withObservation({ type: 'CHAIN', name: 'react.step' }, async (step) => {
      stepId = step.ref!.observationId
      await fn()
    })
  })
  return stepId
}

beforeEach(() => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(
    `CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, provider_id TEXT, created_at TEXT, updated_at TEXT);`,
  )
  initTraceTables(db)
  db.prepare(`INSERT INTO sessions (id) VALUES ('s-1')`).run()
  currentDb.instance = db
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
})

describe('traceMiddleware — stream', () => {
  it('AC-010: records one GENERATION under the step with name, model, TTFT and Langfuse usage buckets', async () => {
    const model = wrapModel(
      new MockLanguageModelV4({ modelId: 'mock-model', doStream: async () => streamResult() }),
      undefined,
    )
    const stepId = await inStep('t-gen', async () => {
      const result = withGenerationName('llm:test', () => streamText({ model, prompt: 'hello' }))
      await result.consumeStream()
    })
    traceRecorder.endTrace('t-gen', {})

    const gens = generations('t-gen')
    expect(gens).toHaveLength(1)
    const g = gens[0]
    expect(g.name).toBe('llm:test')
    expect(g.parent_observation_id).toBe(stepId)
    expect(g.provided_model_name).toBe('mock-model')
    expect(g.completion_start_time).not.toBeNull()
    expect(Date.parse(g.completion_start_time!)).toBeGreaterThanOrEqual(Date.parse(g.start_time))
    expect(g.usage_details).toEqual({
      input: 7,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 0,
      output: 5,
      output_reasoning_tokens: 2,
      total: 17,
    })
    expect(g.metadata.finish_reason).toBe('stop')
    expect(g.level).toBe('DEFAULT')
    expect(JSON.parse(g.output!)).toEqual({ text: 'hi', tool_calls: [] })
  })

  it('AC-011: every retry attempt is its own GENERATION (ERROR then DEFAULT)', async () => {
    let calls = 0
    const model = wrapModel(
      new MockLanguageModelV4({
        doStream: async () => {
          calls++
          if (calls === 1) {
            throw new APICallError({
              message: 'overloaded',
              url: 'u',
              requestBodyValues: {},
              statusCode: 503,
              responseHeaders: { 'retry-after-ms': '0' },
              isRetryable: true,
            })
          }
          return streamResult()
        },
      }),
      undefined,
    )
    await inStep('t-retry', async () => {
      await streamText({ model, prompt: 'hello', maxRetries: 1 }).consumeStream()
    })
    traceRecorder.endTrace('t-retry', {})

    const gens = generations('t-retry')
    expect(gens).toHaveLength(2)
    expect(gens[0]).toMatchObject({ level: 'ERROR', status_message: 'overloaded' })
    expect(gens[1].level).toBe('DEFAULT')
  })

  it('AC-012: aborting mid-stream ends the GENERATION as WARNING / ABORTED', async () => {
    const ac = new AbortController()
    const model = wrapModel(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 'txt' })
              c.enqueue({ type: 'text-delta', id: 'txt', delta: 'h' })
            },
          }),
        }),
      }),
      undefined,
    )
    await inStep('t-abort', async () => {
      const done = streamText({ model, prompt: 'hello', abortSignal: ac.signal }).consumeStream()
      await new Promise((r) => setTimeout(r, 20))
      ac.abort()
      await Promise.race([done, new Promise((r) => setTimeout(r, 500))])
    })
    traceRecorder.endTrace('t-abort', {})

    const [g] = generations('t-abort')
    expect(g).toMatchObject({ level: 'WARNING', status_message: 'ABORTED' })
    expect(g.end_time).not.toBeNull()
  })

  it('records a stream error chunk as ERROR while passing it through', async () => {
    const model = wrapModel(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'error' as const, error: new Error('provider exploded') },
            ],
          }),
        }),
      }),
      undefined,
    )
    await inStep('t-err', async () => {
      await streamText({ model, prompt: 'hello', maxRetries: 0 }).consumeStream()
    })
    traceRecorder.endTrace('t-err', {})
    const [g] = generations('t-err')
    expect(g).toMatchObject({ level: 'ERROR', status_message: 'provider exploded' })
  })

  it('passes through untouched when there is no trace scope', async () => {
    const model = wrapModel(
      new MockLanguageModelV4({ doStream: async () => streamResult() }),
      undefined,
    )
    const result = streamText({ model, prompt: 'hello' })
    expect(await result.text).toBe('hi')
    expect(
      (currentDb.instance!.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number })
        .n,
    ).toBe(0)
  })
})

describe('traceMiddleware — generate', () => {
  it('records GENERATION output, usage and finish reason; default name is "llm"', async () => {
    const model = wrapModel(
      new MockLanguageModelV4({
        modelId: 'gen-model',
        doGenerate: async () => ({
          content: [
            { type: 'text', text: 'ok' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: '{}' },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: USAGE,
          warnings: [],
        }),
      }),
      undefined,
    )
    await inStep('t-generate', async () => {
      await generateText({ model, prompt: 'hello' })
    })
    traceRecorder.endTrace('t-generate', {})
    const [g] = generations('t-generate')
    expect(g.name).toBe('llm')
    expect(g.provided_model_name).toBe('gen-model')
    expect(JSON.parse(g.output!)).toEqual({
      text: 'ok',
      tool_calls: [{ toolCallId: 'c1', toolName: 'echo' }],
    })
    expect(g.metadata.finish_reason).toBe('tool-calls')
    expect(g.usage_details?.total).toBe(17)
    const prompt = JSON.parse(g.input!) as { messages: Array<{ role: string }> }
    expect(prompt.messages.map((m) => m.role)).toEqual(['user'])
  })

  it('marks a thrown generate error as ERROR and rethrows it', async () => {
    const model = wrapModel(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error('bad request')
        },
      }),
      undefined,
    )
    let caught: unknown
    await inStep('t-generate-err', async () => {
      await generateText({ model, prompt: 'hello', maxRetries: 0 }).catch((e) => {
        caught = e
      })
    })
    traceRecorder.endTrace('t-generate-err', {})
    expect(caught).toBeInstanceOf(Error)
    expect(generations('t-generate-err')[0]).toMatchObject({
      level: 'ERROR',
      status_message: 'bad request',
    })
  })
})

describe('toUsageDetails', () => {
  it('derives non-overlapping buckets when noCache / text are missing', () => {
    expect(
      toUsageDetails({
        inputTokens: { total: 10, cacheRead: 3 },
        outputTokens: { total: 7, reasoning: 2 },
      }),
    ).toEqual({
      input: 7,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 0,
      output: 5,
      output_reasoning_tokens: 2,
      total: 17,
    })
  })

  it('returns undefined for non-object usage and clamps negative derivations to 0', () => {
    expect(toUsageDetails(undefined)).toBeUndefined()
    expect(toUsageDetails({ inputTokens: { total: 1, cacheRead: 5 }, outputTokens: {} })).toEqual({
      input: 0,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 0,
      output: 0,
      output_reasoning_tokens: 0,
      total: 5,
    })
  })

  it('falls back to providerMetadata cache tokens like normalizeUsage when SDK cache details are missing', () => {
    // deepseek 偶发不填 inputTokens 细分:与 session 统计同口径,从 providerMetadata 取缓存命中
    expect(
      toUsageDetails(
        { inputTokens: { total: 100 }, outputTokens: { total: 10, text: 10 } },
        { deepseek: { promptCacheHitTokens: 80 } },
      ),
    ).toEqual({
      input: 20,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 0,
      output: 10,
      output_reasoning_tokens: 0,
      total: 110,
    })
  })

  it('(no-trigger) SDK cache details win over providerMetadata', () => {
    expect(
      toUsageDetails(
        { inputTokens: { total: 100, noCache: 60, cacheRead: 40 }, outputTokens: { total: 1 } },
        { deepseek: { promptCacheHitTokens: 80 } },
      ),
    ).toMatchObject({ input: 60, cache_read_input_tokens: 40 })
  })
})
