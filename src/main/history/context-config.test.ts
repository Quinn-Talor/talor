import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { values } = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: (key: string) => values[key] }) },
}))

import type { Provider } from '../store/config-store'
import {
  engineContextConfig,
  FALLBACK_CONTEXT_WINDOW,
  modelContextWindow,
  resolveProviderConfig,
} from './context-config'
import { resolveProviderConfig as fromPipeline } from '../prompt/PromptPipeline'

const provider = (patch: Partial<Provider> = {}) =>
  ({ id: 'p1', type: 'openai', name: 'P1', models: [], ...patch }) as unknown as Provider

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key]
})

describe('modelContextWindow / engineContextConfig', () => {
  it('AC-006 takes provider, known window, global setting, then the fallback', () => {
    values.default_recent_ratio = 0.1
    expect(modelContextWindow(provider({ context_limit: 50000 }), 'deepseek-chat')).toBe(50000)
    expect(modelContextWindow(provider(), 'deepseek-chat')).toBe(128000)
    expect(modelContextWindow(provider(), 'claude-sonnet-4')).toBe(200000)
    values.default_context_limit = 300000
    expect(modelContextWindow(provider(), 'unknown-x')).toBe(300000)
    delete values.default_context_limit
    expect(modelContextWindow(provider(), 'unknown-x')).toBe(128000)
    expect(FALLBACK_CONTEXT_WINDOW).toBe(128000)

    for (const [p, id] of [
      [provider({ context_limit: 50000 }), 'deepseek-chat'],
      [provider(), 'deepseek-chat'],
      [provider(), 'unknown-x'],
    ] as const) {
      expect(engineContextConfig(p, id)).toEqual({
        ...resolveProviderConfig(p, id),
        context_limit: modelContextWindow(p, id),
      })
    }
  })
})

describe('resolveProviderConfig (moved)', () => {
  it('AC-007 gives the same result from the new and the old location', () => {
    values.default_context_limit = 300000
    values.default_summary_ratio = 0.2
    for (const p of [provider(), provider({ context_limit: 50000, recent_ratio: 0.3 })]) {
      expect(fromPipeline(p, 'deepseek-chat')).toEqual(resolveProviderConfig(p, 'deepseek-chat'))
    }
    // 旧路径不变：未配上限时仍取全局设置，不看模型窗口
    expect(resolveProviderConfig(provider(), 'deepseek-chat')).toEqual({
      provider: provider(),
      modelId: 'deepseek-chat',
      context_limit: 300000,
      recent_ratio: 0.05,
      summary_ratio: 0.2,
    })
    delete values.default_context_limit
    expect(resolveProviderConfig(provider()).context_limit).toBe(1_000_000)
  })
})
