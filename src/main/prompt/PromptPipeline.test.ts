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
  it('non-critical plugin failure: other plugins still run, [DEGRADED] notice prepended', async () => {
    const pipeline = await mockAllPlugins({
      SystemPlugin: { messages: [{ role: 'system', content: 'sys' }], tools: [], tokenEstimate: 0 },
      ToolSelectionPlugin: new Error('tool selection failed'),
    })
    const result = await pipeline.build(makeCtx())

    expect(result.messages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('[DEGRADED]'),
    })
    expect(result.messages[0].content as string).toContain('ToolSelectionPlugin')
    expect(result.messages).toContainEqual({ role: 'system', content: 'sys' })
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
