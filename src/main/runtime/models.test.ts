import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet }) },
}))

import { isModelCallError, type ModelInput, type ModelPort } from '@talor/agent-engine'
import type { Provider } from '../store/config-store'
import { modelRefOf, parseModelRef, talorModels } from './models'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    type: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com',
    models: [],
    enabled: true,
    is_default: true,
    supports_vision: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const reply: LanguageModelV4StreamPart[] = [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'ok' },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  },
]

function setup(initial: Provider | null) {
  let provider = initial
  const models: MockLanguageModelV4[] = []
  const library = talorModels({
    getProvider: (id) => (provider && provider.id === id ? provider : null),
    createModel: () => {
      const model = new MockLanguageModelV4({
        doStream: async () => ({ stream: convertArrayToReadableStream(reply) }),
      })
      models.push(model)
      return model
    },
  })
  return {
    library,
    models,
    setProvider: (next: Provider | null) => {
      provider = next
    },
  }
}

const input: ModelInput = { messages: [{ role: 'user', content: 'hi' }], tools: [] }
const call = (port: ModelPort) =>
  port.call(input, { signal: new AbortController().signal, onDelta: () => {} })

beforeEach(() => {
  mockGet.mockReset()
  mockGet.mockImplementation((key: string) =>
    key === 'default_context_limit' ? 500_000 : undefined,
  )
})

describe('parseModelRef / modelRefOf', () => {
  it('splits the provider id at the first slash and keeps the rest as the model id', () => {
    expect(parseModelRef('talor:p1/ollama/qwen3:4b')).toEqual({
      providerId: 'p1',
      modelId: 'ollama/qwen3:4b',
    })
  })

  it('round-trips a session reasoning override', () => {
    const ref = modelRefOf('p1', 'o3', { enabled: true, effort: 'high' })
    expect(parseModelRef(ref)).toEqual({
      providerId: 'p1',
      modelId: 'o3',
      reasoning: { enabled: true, effort: 'high' },
    })
  })

  it('rejects refs of other providers or without a model id', () => {
    expect(parseModelRef('other:p1/m')).toBeUndefined()
    expect(parseModelRef('talor:p1')).toBeUndefined()
    expect(parseModelRef('talor:p1/')).toBeUndefined()
    expect(parseModelRef('talor:p1/m?reasoning=%7Bbad')).toBeUndefined()
  })
})

describe('talorModels', () => {
  it('AC-001 resolves an enabled provider with its capabilities and rejects unknown refs', () => {
    const { library } = setup(makeProvider({ context_limit: 200_000, supports_vision: true }))

    const port = library.resolve('talor:p1/m1')!
    expect(port.ref).toBe('talor:p1/m1')
    expect(port.capabilities).toMatchObject({
      contextLimit: 200_000,
      maxOutputTokens: 64_000,
      inputs: ['image'],
      toolCalls: true,
      reasoning: 'none',
    })
    expect(library.resolve('talor:p1/ollama/qwen3:4b')).toBeDefined()
    expect(library.resolve('talor:missing/m')).toBeUndefined()
    expect(library.resolve('other:p1/m')).toBeUndefined()
  })

  it('AC-001 declares pdf input only for anthropic/google, and no media without vision', () => {
    const cap = (type: Provider['type'], vision: boolean) =>
      setup(makeProvider({ type, supports_vision: vision })).library.resolve('talor:p1/m1')!
        .capabilities.inputs
    expect(cap('anthropic', true)).toEqual(['image', 'pdf'])
    expect(cap('google', true)).toEqual(['image', 'pdf'])
    expect(cap('openai', true)).toEqual(['image'])
    expect(cap('anthropic', false)).toEqual([])
  })

  it('AC-001 falls back to the configured default context limit', () => {
    const { library } = setup(makeProvider())
    expect(library.resolve('talor:p1/m1')!.capabilities.contextLimit).toBe(500_000)
  })

  it('C3 AC-007 takes the configured window and output limit, not built-in values', () => {
    const { library } = setup(makeProvider({ max_output_tokens: 8_000 }))
    expect(library.resolve('talor:p1/deepseek-chat')!.capabilities).toMatchObject({
      contextLimit: 500_000,
      maxOutputTokens: 8_000,
    })
  })

  it('AC-002 passes the provider headers and provider options to the model', async () => {
    const { library, models } = setup(
      makeProvider({ headers: { 'x-a': '1' }, provider_options: { openai: { user: 'u' } } }),
    )

    const response = await call(library.resolve('talor:p1/m1')!)

    expect(response.text).toBe('ok')
    const params = models[0]!.doStreamCalls[0]!
    expect(params.headers).toMatchObject({ 'x-a': '1' })
    expect(params.providerOptions?.openai).toMatchObject({ parallelToolCalls: true, user: 'u' })
  })

  it('AC-003 applies a session reasoning override carried in the ref', async () => {
    const { library, models } = setup(makeProvider({ reasoning: { enabled: false } }))

    await call(library.resolve(modelRefOf('p1', 'o3', { enabled: true, effort: 'high' }))!)
    await call(library.resolve(modelRefOf('p1', 'o3'))!)

    expect(models[0]!.doStreamCalls[0]!.providerOptions?.openai).toMatchObject({
      reasoningEffort: 'high',
    })
    expect(models[1]!.doStreamCalls[0]!.providerOptions?.openai).not.toHaveProperty(
      'reasoningEffort',
    )
  })

  it('AC-004 reads the current provider config on every call', async () => {
    const { library, models, setProvider } = setup(makeProvider({ headers: { 'x-a': '1' } }))
    const port = library.resolve('talor:p1/m1')!
    await call(port)

    setProvider(makeProvider({ headers: { 'x-a': '2' } }))
    await call(port)
    expect(models[1]!.doStreamCalls[0]!.headers).toMatchObject({ 'x-a': '2' })

    setProvider(null)
    const error = await call(port).catch((e: unknown) => e)
    expect(isModelCallError(error) && error.detail.code).toBe('MODEL_UNAVAILABLE')
  })

  it('declares the current call settings for the model fingerprint, without header values', () => {
    const { library, setProvider } = setup(
      makeProvider({
        headers: { authorization: 'secret-1' },
        provider_options: { openai: { user: 'u' } },
      }),
    )
    const port = library.resolve('talor:p1/m1')!
    const before = JSON.stringify(port.settings)
    expect(before).toContain('"user":"u"')
    expect(before).toContain('authorization')
    expect(before).not.toContain('secret-1')

    // 只换 header 的值（例如轮换凭据）不改变配置；改了 provider options 会变
    setProvider(
      makeProvider({
        headers: { authorization: 'secret-2' },
        provider_options: { openai: { user: 'u' } },
      }),
    )
    expect(JSON.stringify(port.settings)).toBe(before)
    setProvider(
      makeProvider({
        headers: { authorization: 'secret-2' },
        provider_options: { openai: { user: 'v' } },
      }),
    )
    expect(JSON.stringify(port.settings)).not.toBe(before)
  })
})

describe('request timeout (A5b)', () => {
  function hanging(delayMs?: number) {
    const signals: AbortSignal[] = []
    const library = talorModels({
      getProvider: (id) =>
        id === 'p1' ? makeProvider(delayMs === undefined ? { request_timeout_ms: 50 } : {}) : null,
      createModel: () =>
        new MockLanguageModelV4({
          doStream: async (options) => {
            if (options.abortSignal) signals.push(options.abortSignal)
            if (delayMs !== undefined) {
              await new Promise((resolve) => setTimeout(resolve, delayMs))
              return { stream: convertArrayToReadableStream(reply) }
            }
            return new Promise((_, reject) => {
              options.abortSignal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              )
            })
          },
        }),
    })
    return { port: library.resolve(modelRefOf('p1', 'm1'))!, signals }
  }

  it('AC-005 fails with MODEL_TIMEOUT when the provider request timeout passes', async () => {
    const { port, signals } = hanging()
    const error = await call(port).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(isModelCallError(error)).toBe(true)
    expect((error as { detail: unknown }).detail).toMatchObject({
      code: 'MODEL_TIMEOUT',
      retryable: true,
    })
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it('AC-005 does not time a provider without a request timeout', async () => {
    const { port } = hanging(80)
    await expect(call(port)).resolves.toMatchObject({ text: 'ok' })
  })
})
