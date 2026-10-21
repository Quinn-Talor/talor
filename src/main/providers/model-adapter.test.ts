import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync, type Dirent } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { generateText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { DEFAULT_TRACE_CONFIG } from '@shared/types/trace'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

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

import { initTraceTables } from '../db/index'
import { traceRepo } from '../repos/trace-repo'
import { runInScope } from '../observe/trace-context'
import { traceRecorder } from '../observe/trace-recorder'
import { mergeProviderOptions, resolveStreamOptions, type ModelAdapter } from './model-adapter'
import { wrapModel } from './middleware'
import type { Provider } from '../store/config-store'

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

describe('mergeProviderOptions（AC-006）', () => {
  it('按 provider-key 逐层合并，不互相覆盖', () => {
    const result = mergeProviderOptions(
      { providerOptions: { openai: { a: 1 } } },
      { providerOptions: { openai: { b: 2 } } },
    )
    expect(result).toEqual({ providerOptions: { openai: { a: 1, b: 2 } } })
  })

  it('不传任何参数 → 返回空 providerOptions（不触发）', () => {
    expect(mergeProviderOptions()).toEqual({ providerOptions: {} })
  })

  it('undefined 来源被跳过，不抛异常', () => {
    const result = mergeProviderOptions(undefined, { providerOptions: { anthropic: { x: 1 } } })
    expect(result).toEqual({ providerOptions: { anthropic: { x: 1 } } })
  })
})

describe('resolveStreamOptions（AC-007）', () => {
  it('provider.reasoning 为 undefined → 返回值与 adapter.buildStreamOptions() 完全一致（回归，不触发）', () => {
    const adapter: ModelAdapter = {
      createModel: () => ({}) as never,
      fetchModels: async () => [],
      buildStreamOptions: () => ({ providerOptions: { openai: { parallelToolCalls: true } } }),
      applyReasoningConfig: () => ({ providerOptions: { openai: { reasoningEffort: 'high' } } }),
    }
    const provider = makeProvider({ reasoning: undefined })
    expect(resolveStreamOptions(adapter, provider)).toEqual(adapter.buildStreamOptions())
  })

  it('adapter 未实现 applyReasoningConfig → 返回值与 buildStreamOptions() 一致（不触发）', () => {
    const adapter: ModelAdapter = {
      createModel: () => ({}) as never,
      fetchModels: async () => [],
      buildStreamOptions: () => ({}),
    }
    const provider = makeProvider({ reasoning: { enabled: true } })
    expect(resolveStreamOptions(adapter, provider)).toEqual({})
  })

  it('provider.reasoning 存在且 adapter 支持 → 合并 adapter 默认值与 reasoning 翻译', () => {
    const adapter: ModelAdapter = {
      createModel: () => ({}) as never,
      fetchModels: async () => [],
      buildStreamOptions: () => ({ providerOptions: { openai: { parallelToolCalls: true } } }),
      applyReasoningConfig: () => ({ providerOptions: { openai: { reasoningEffort: 'high' } } }),
    }
    const provider = makeProvider({ reasoning: { enabled: true, effort: 'high' } })
    expect(resolveStreamOptions(adapter, provider)).toEqual({
      providerOptions: { openai: { parallelToolCalls: true, reasoningEffort: 'high' } },
    })
  })
})

describe('resolveStreamOptions — 按模型推理能力门控', () => {
  const adapter: ModelAdapter = {
    createModel: () => ({}) as never,
    fetchModels: async () => [],
    buildStreamOptions: () => ({ providerOptions: { openai: { parallelToolCalls: true } } }),
    applyReasoningConfig: () => ({ providerOptions: { openai: { reasoningEffort: 'high' } } }),
  }

  it('非推理模型(gpt-4o)→ 不下发推理参数', () => {
    const provider = makeProvider({ reasoning: { enabled: true, effort: 'high' } })
    expect(resolveStreamOptions(adapter, provider, 'openai/gpt-4o')).toEqual(
      adapter.buildStreamOptions(),
    )
  })

  it('推理模型(gpt-5)→ 下发推理参数(不触发门控)', () => {
    const provider = makeProvider({ reasoning: { enabled: true, effort: 'high' } })
    expect(resolveStreamOptions(adapter, provider, 'openai/gpt-5')).toEqual({
      providerOptions: { openai: { parallelToolCalls: true, reasoningEffort: 'high' } },
    })
  })

  it('模型列表里手动标记的 reasoning capability 优先于名称匹配', () => {
    const provider = makeProvider({
      reasoning: { enabled: true },
      models: [
        {
          id: 'openai/my-thinker',
          name: 'my-thinker',
          provider_id: 'p1',
          display_name: 'x',
          capabilities: [
            {
              category: 'reasoning',
              type: 'configurable_reasoning',
              supported: true,
              description: '',
              source: 'manual',
            },
          ],
        },
      ],
    })
    expect(resolveStreamOptions(adapter, provider, 'openai/my-thinker')).toMatchObject({
      providerOptions: { openai: { reasoningEffort: 'high' } },
    })
  })

  it('adapter 返回顶层 reasoning 时保留在 streamOptions 顶层', () => {
    const topLevel: ModelAdapter = {
      ...adapter,
      buildStreamOptions: () => ({}),
      applyReasoningConfig: () => ({ reasoning: 'low' }),
    }
    const provider = makeProvider({ type: 'google', reasoning: { enabled: true, effort: 'low' } })
    expect(resolveStreamOptions(topLevel, provider, 'google/gemini-2.5-flash')).toEqual({
      reasoning: 'low',
      providerOptions: {},
    })
  })
})

describe('wrapModel（turn-trace AC-013）', () => {
  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  /** 递归列出非测试 .ts 文件;并行测试会临时建删目录(如 ls 工具测试),扫描中消失的目录跳过。 */
  function listSourceFiles(dir: string): string[] {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return entries.flatMap((e) => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return listSourceFiles(p)
      return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : []
    })
  }

  it('AC-013: installs traceMiddleware even without provider middleware; wrapLanguageModel is called only here', async () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY);`)
    initTraceTables(db)
    db.prepare(`INSERT INTO sessions (id) VALUES ('s-1')`).run()
    currentDb.instance = db

    const model = wrapModel(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        }),
      }),
      undefined,
    )
    const scope = traceRecorder.startTrace({
      id: 't-wrap',
      sessionId: 's-1',
      name: 'turn',
      input: 'hi',
      rootName: 'agent:test',
      config: DEFAULT_TRACE_CONFIG,
    })
    await runInScope(scope, () => generateText({ model, prompt: 'hello' }))
    traceRecorder.endTrace('t-wrap', {})
    expect(
      traceRepo.listObservations('t-wrap').filter((o) => o.type === 'GENERATION'),
    ).toHaveLength(1)

    const mainDir = fileURLToPath(new URL('..', import.meta.url))
    const callers = listSourceFiles(mainDir).filter((f) =>
      readFileSync(f, 'utf-8').includes('wrapLanguageModel('),
    )
    expect(callers.map((f) => f.slice(mainDir.length))).toEqual(['providers/middleware/index.ts'])
    for (const adapter of ['anthropic', 'google', 'ollama', 'openai']) {
      const src = readFileSync(
        join(mainDir, 'providers/adapters', `${adapter}-adapter.ts`),
        'utf-8',
      )
      expect(src).toContain('wrapModel(')
    }
  })
})
