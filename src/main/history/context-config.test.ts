import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { values } = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: (key: string) => values[key] }) },
}))

import type { Provider } from '../store/config-store'
import { FALLBACK_CONTEXT_WINDOW, modelContextWindow } from './context-config'

const provider = (patch: Partial<Provider> = {}) =>
  ({ id: 'p1', type: 'openai', name: 'P1', models: [], ...patch }) as unknown as Provider

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key]
})

describe('modelContextWindow', () => {
  it('AC-006 takes the provider setting, then the global setting, then the fallback', () => {
    values.default_recent_ratio = 0.1
    values.default_context_limit = 1_000_000
    expect(modelContextWindow(provider({ context_limit: 50000 }), 'deepseek-chat')).toBe(50000)
    expect(modelContextWindow(provider(), 'deepseek-chat')).toBe(1_000_000)
    expect(modelContextWindow(provider(), 'claude-sonnet-4')).toBe(1_000_000)
    values.default_context_limit = 300000
    expect(modelContextWindow(provider(), 'unknown-x')).toBe(300000)
    delete values.default_context_limit
    expect(modelContextWindow(provider(), 'deepseek-chat')).toBe(128000)
    expect(FALLBACK_CONTEXT_WINDOW).toBe(128000)
  })
})
