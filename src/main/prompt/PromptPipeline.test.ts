import { describe, it, expect, vi } from 'vitest'
import { resolveProviderConfig, PromptPipeline } from './PromptPipeline'
import type { Provider } from '../store/config-store'
import type { PipelineContext, PluginResult } from './types'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1', type: 'ollama', name: 'test', base_url: '', models: [],
    enabled: true, is_default: true, supports_vision: false,
    created_at: '', updated_at: '',
    ...overrides,
  }
}

const mockGet = vi.fn((key: string) => key === 'default_context_limit' ? undefined : undefined)
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
vi.mock('./plugins/ToolSelectionPlugin', () => ({ ToolSelectionPlugin: vi.fn() }))
vi.mock('../memory/MemoryManager', () => ({ MemoryManager: vi.fn() }))

function makeCtx(): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as Provider,
    providerConfig: { provider: { id: 'p1' } as Provider, context_limit: 8000, recent_ratio: 0.05, summary_ratio: 0.10 },
    workspacePath: undefined,
  }
}

describe('PromptPipeline.build — plugin isolation', () => {
  it('一个插件抛错时，其余插件结果仍然返回', async () => {
    const { SystemPlugin } = await import('./plugins/SystemPlugin')
    const { AgentPromptPlugin } = await import('./plugins/AgentPromptPlugin')
    const { MemoryPlugin } = await import('./plugins/MemoryPlugin')
    const { ToolSelectionPlugin } = await import('./plugins/ToolSelectionPlugin')
    const { MemoryManager } = await import('../memory/MemoryManager')

    const goodResult: PluginResult = { messages: [{ role: 'system', content: 'ok' }], tools: [], tokenEstimate: 0 }
    vi.mocked(SystemPlugin).mockImplementation(() => ({
      name: 'SystemPlugin',
      build: vi.fn().mockResolvedValue(goodResult),
    }) as unknown as InstanceType<typeof SystemPlugin>)
    vi.mocked(AgentPromptPlugin).mockImplementation(() => ({
      name: 'AgentPromptPlugin',
      build: vi.fn().mockRejectedValue(new Error('agent load failed')),
    }) as unknown as InstanceType<typeof AgentPromptPlugin>)
    vi.mocked(MemoryPlugin).mockImplementation(() => ({
      name: 'MemoryPlugin',
      build: vi.fn().mockResolvedValue({ messages: [], tools: [], tokenEstimate: 0 }),
    }) as unknown as InstanceType<typeof MemoryPlugin>)
    vi.mocked(ToolSelectionPlugin).mockImplementation(() => ({
      name: 'ToolSelectionPlugin',
      build: vi.fn().mockResolvedValue({ messages: [], tools: [{ name: 't1', description: '', parameters: {} }], tokenEstimate: 0 }),
    }) as unknown as InstanceType<typeof ToolSelectionPlugin>)
    vi.mocked(MemoryManager).mockImplementation(() => ({}) as unknown as InstanceType<typeof MemoryManager>)

    const pipeline = new PromptPipeline(new MemoryManager())
    const result = await pipeline.build(makeCtx())

    // Should not throw; should have messages from SystemPlugin and tool from ToolSelectionPlugin
    expect(result.messages).toHaveLength(1)
    expect(result.tools).toHaveLength(1)
  })
})
