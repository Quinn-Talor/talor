import { describe, it, expect, vi } from 'vitest'
import { resolveProviderConfig, PromptPipeline } from './PromptPipeline'
import type { Provider } from '../store/config-store'
import type { PipelineContext, PluginResult } from './types'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    type: 'ollama',
    name: 'test',
    base_url: '',
    models: [],
    enabled: true,
    is_default: true,
    supports_vision: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const mockGet = vi.fn((key: string) => (key === 'default_context_limit' ? undefined : undefined))
const mockInstance = { get: mockGet }

vi.mock('../store/config-store', () => ({
  ConfigStore: {
    getInstance: vi.fn(() => mockInstance),
  },
}))

import { ConfigStore } from '../store/config-store'

describe('resolveProviderConfig', () => {
  it('AC-002-01: provider.context_limit 优先', () => {
    mockGet.mockReturnValue(8000)
    const cfg = resolveProviderConfig(makeProvider({ context_limit: 16000 }))
    expect(cfg.context_limit).toBe(16000)
  })

  it('AC-002-02: provider 无配置时使用 appConfig 默认', () => {
    mockGet.mockReturnValue(12000)
    const cfg = resolveProviderConfig(makeProvider())
    expect(cfg.context_limit).toBe(12000)
  })

  it('AC-002-03: appConfig 也无配置时使用硬编码兜底 1M', () => {
    mockGet.mockReturnValue(undefined)
    const cfg = resolveProviderConfig(makeProvider())
    expect(cfg.context_limit).toBe(1_000_000)
  })

  it('recent_ratio 和 summary_ratio 使用默认值', () => {
    mockGet.mockReturnValue(undefined)
    const cfg = resolveProviderConfig(makeProvider())
    expect(cfg.recent_ratio).toBe(0.05)
    expect(cfg.summary_ratio).toBe(0.05)
  })
})

vi.mock('./plugins/SystemPlugin', () => ({ SystemPlugin: vi.fn() }))
vi.mock('./plugins/AgentPromptPlugin', () => ({ AgentPromptPlugin: vi.fn() }))
vi.mock('./plugins/MemoryPlugin', () => ({ MemoryPlugin: vi.fn() }))
vi.mock('./plugins/MessagePlugin', () => ({ MessagePlugin: vi.fn() }))
vi.mock('./plugins/ToolSelectionPlugin', () => ({ ToolSelectionPlugin: vi.fn() }))
vi.mock('../memory/MemoryManager', () => ({ MemoryManager: vi.fn() }))

function makeCtx(): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as Provider,
    providerConfig: {
      provider: { id: 'p1' } as Provider,
      context_limit: 8000,
      recent_ratio: 0.05,
      summary_ratio: 0.1,
    },
    workspacePath: undefined,
  }
}

async function mockAllPlugins(
  overrides: {
    SystemPlugin?: PluginResult | Error
    AgentPromptPlugin?: PluginResult | Error
    MemoryPlugin?: PluginResult | Error
    MessagePlugin?: PluginResult | Error
    ToolSelectionPlugin?: PluginResult | Error
  } = {},
) {
  const { SystemPlugin } = await import('./plugins/SystemPlugin')
  const { AgentPromptPlugin } = await import('./plugins/AgentPromptPlugin')
  const { MemoryPlugin } = await import('./plugins/MemoryPlugin')
  const { MessagePlugin } = await import('./plugins/MessagePlugin')
  const { ToolSelectionPlugin } = await import('./plugins/ToolSelectionPlugin')
  const { MemoryManager } = await import('../memory/MemoryManager')

  const empty: PluginResult = { messages: [], tools: [], tokenEstimate: 0 }

  const LAYERS: Record<string, string> = {
    SystemPlugin: 'system',
    AgentPromptPlugin: 'agent',
    MemoryPlugin: 'history',
    MessagePlugin: 'volatile',
    ToolSelectionPlugin: 'tools',
  }

  const configure = <T>(
    name: string,
    ctor: T,
    spec: PluginResult | Error | undefined,
    fallback: PluginResult,
  ) => {
    const build =
      spec instanceof Error
        ? vi.fn().mockRejectedValue(spec)
        : vi.fn().mockResolvedValue(spec ?? fallback)
    // Vitest 4: 被 `new` 调用的 mock 必须用 function expression(arrow 会报
    // "X is not a constructor")。`this` 在 function body 里赋值于实例。
    vi.mocked(ctor as unknown as new () => unknown).mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      this.name = name
      this.layer = LAYERS[name] ?? 'volatile'
      this.build = build
    } as unknown as new () => unknown)
  }

  configure('SystemPlugin', SystemPlugin, overrides.SystemPlugin, empty)
  configure('AgentPromptPlugin', AgentPromptPlugin, overrides.AgentPromptPlugin, empty)
  configure('MemoryPlugin', MemoryPlugin, overrides.MemoryPlugin, empty)
  configure('MessagePlugin', MessagePlugin, overrides.MessagePlugin, empty)
  configure('ToolSelectionPlugin', ToolSelectionPlugin, overrides.ToolSelectionPlugin, empty)
  // Vitest 4 起 mockImplementation 的 fn 必须可作 constructor(被 `new` 调用),
  // arrow function 不满足 — 用 function expression 包一层。
  vi.mocked(MemoryManager).mockImplementation(function (this: unknown) {
    return {} as unknown as InstanceType<typeof MemoryManager>
  } as unknown as typeof MemoryManager)

  return new PromptPipeline(new MemoryManager())
}

describe('PromptPipeline.build', () => {
  it('non-critical plugin failure: other plugins still run, [DEGRADED] notice in volatile tail', async () => {
    const pipeline = await mockAllPlugins({
      SystemPlugin: { messages: [{ role: 'system', content: 'sys' }], tools: [], tokenEstimate: 0 },
      ToolSelectionPlugin: new Error('tool selection failed'),
    })
    const result = await pipeline.build(makeCtx())

    // append-only 设计:DEGRADED 是易变内容 → 归 volatile 尾部(不再 prepend 到 [0])。
    const degraded = result.messages.find(
      (m) => typeof m.content === 'string' && m.content.startsWith('[DEGRADED]'),
    )
    expect(degraded).toBeDefined()
    expect(degraded!.content as string).toContain('ToolSelectionPlugin')
    // 稳定层 system('sys')应排在易变 DEGRADED 之前。
    const sysIdx = result.messages.findIndex(
      (m) => typeof m.content === 'string' && m.content === 'sys',
    )
    const degIdx = result.messages.findIndex(
      (m) => typeof m.content === 'string' && m.content.startsWith('[DEGRADED]'),
    )
    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(degIdx).toBeGreaterThan(sysIdx)
  })

  it('critical plugin failure (MemoryPlugin): throws with plugin name', async () => {
    const pipeline = await mockAllPlugins({
      MemoryPlugin: new Error('db locked'),
    })
    await expect(pipeline.build(makeCtx())).rejects.toThrow(/Critical prompt plugin "MemoryPlugin"/)
  })

  it('critical plugin failure (MessagePlugin): throws with plugin name', async () => {
    const pipeline = await mockAllPlugins({
      MessagePlugin: new Error('db read failed'),
    })
    await expect(pipeline.build(makeCtx())).rejects.toThrow(
      /Critical prompt plugin "MessagePlugin"/,
    )
  })

  const hasCacheBreakpoint = (m: { providerOptions?: unknown }) =>
    !!(m.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)?.anthropic
      ?.cacheControl

  it('anthropic provider: 稳定前缀末条打 cacheControl 断点', async () => {
    const pipeline = await mockAllPlugins({
      SystemPlugin: { messages: [{ role: 'system', content: 'sys' }], tools: [], tokenEstimate: 0 },
    })
    const ctx = makeCtx()
    ctx.provider = { id: 'p1', type: 'anthropic' } as Provider
    const result = await pipeline.build(ctx)
    expect(result.messages.some(hasCacheBreakpoint)).toBe(true)
  })

  it('非 anthropic provider(openai): 不打断点(自动缓存)', async () => {
    const pipeline = await mockAllPlugins({
      SystemPlugin: { messages: [{ role: 'system', content: 'sys' }], tools: [], tokenEstimate: 0 },
    })
    const ctx = makeCtx()
    ctx.provider = { id: 'p1', type: 'openai' } as Provider
    const result = await pipeline.build(ctx)
    expect(result.messages.some(hasCacheBreakpoint)).toBe(false)
  })

  // 回归:tool_use(history 末尾)与 tool_result(当前 turn)之间不得插入任何消息。
  // Phase 1 把 RuntimeMetaPlugin(volatile)排在 MessagePlugin 前,导致其 system 消息
  // 劈开二者 → SDK convertToLanguageModelPrompt 抛 AI_MissingToolResultsError → 每个
  // 工具回合的续做步必崩。MessagePlugin 契约要求 Memory 末尾 ↔ Message 相邻配对。
  it('tool_use 与 tool_result 必须相邻(volatile 元信息不得劈开配对)', async () => {
    const pipeline = await mockAllPlugins({
      MemoryPlugin: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'bash', input: {} }],
          },
        ],
        tools: [],
        tokenEstimate: 0,
      },
      MessagePlugin: {
        messages: [
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'tc1',
                toolName: 'bash',
                output: { type: 'text', value: 'ok' },
              },
            ],
          },
        ],
        tools: [],
        tokenEstimate: 0,
      },
    })
    const result = await pipeline.build(makeCtx())

    const hasCall = (m: { content: unknown }) =>
      Array.isArray(m.content) && m.content.some((p: { type?: string }) => p.type === 'tool-call')
    const hasResult = (m: { content: unknown }) =>
      Array.isArray(m.content) && m.content.some((p: { type?: string }) => p.type === 'tool-result')
    const callIdx = result.messages.findIndex(hasCall)
    const resultIdx = result.messages.findIndex(hasResult)
    expect(callIdx).toBeGreaterThanOrEqual(0)
    expect(resultIdx).toBe(callIdx + 1) // 必须紧邻;中间有 RuntimeMeta 则失败
  })

  it('all plugins succeed: no [DEGRADED] notice', async () => {
    const pipeline = await mockAllPlugins({
      SystemPlugin: { messages: [{ role: 'system', content: 'sys' }], tools: [], tokenEstimate: 0 },
      ToolSelectionPlugin: {
        messages: [],
        tools: [{ name: 't1', description: '', parameters: {} }],
        tokenEstimate: 0,
      },
    })
    const result = await pipeline.build(makeCtx())

    expect(
      result.messages.some(
        (m) => typeof m.content === 'string' && m.content.startsWith('[DEGRADED]'),
      ),
    ).toBe(false)
    expect(result.tools).toHaveLength(1)
  })
})
