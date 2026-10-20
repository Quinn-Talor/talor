// session:create —— 新建会话不因拉取模型列表失败而失败(key 失效 / 断网时按钮仍可用)。

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockHandle, mockGet, mockGetProviderModels, mockSessionCreate } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockGet: vi.fn(),
  mockGetProviderModels: vi.fn(),
  mockSessionCreate: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet }) },
}))

vi.mock('../providers/provider-fetcher', () => ({
  getProviderModels: (...args: unknown[]) => mockGetProviderModels(...args),
}))

vi.mock('../providers/model-availability', () => ({ checkModelAvailability: vi.fn() }))

vi.mock('../repos/session-repo', () => ({
  sessionRepo: { create: (...args: unknown[]) => mockSessionCreate(...args) },
  messageRepo: {},
}))

import log from 'electron-log'
import { registerSessionHandlers } from './session'

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`handler not registered for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

const PROVIDER = {
  id: 'p1',
  type: 'openai',
  base_url: 'https://api.deepseek.com',
  models: [{ id: 'configured-model' }],
}

describe('session:create — 默认模型解析', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    mockGet.mockReset()
    mockGetProviderModels.mockReset()
    mockSessionCreate.mockReset()
    vi.mocked(log.warn).mockClear()
    mockGet.mockReturnValue({ p1: PROVIDER })
    mockSessionCreate.mockImplementation((p: unknown) => ({ id: 's-new', ...(p as object) }))
    registerSessionHandlers()
  })

  it('拉取模型列表失败(如 401)→ 仍建会话,回落到 provider 已配置的第一个模型并记 warn', async () => {
    mockGetProviderModels.mockRejectedValue(new Error('Failed to fetch models: HTTP 401'))
    const res = await getHandler('session:create')(null, { provider_id: 'p1' })

    expect(res).toMatchObject({ id: 's-new' })
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ provider_id: 'p1', model_id: 'configured-model' }),
    )
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
  })

  it('拉取失败且 provider 未配置模型 → model_id 留空,仍建会话(发送时由 orchestrator 回落)', async () => {
    mockGet.mockReturnValue({ p1: { ...PROVIDER, models: [] } })
    mockGetProviderModels.mockRejectedValue(new Error('network down'))
    await getHandler('session:create')(null, { provider_id: 'p1' })

    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ provider_id: 'p1', model_id: undefined }),
    )
  })

  it('(不触发)拉取成功 → 用拉到的第一个模型,不记 warn', async () => {
    mockGetProviderModels.mockResolvedValue([{ id: 'live-model' }, { id: 'other' }])
    await getHandler('session:create')(null, { provider_id: 'p1' })

    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model_id: 'live-model' }),
    )
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled()
  })

  it('(不触发)显式传 model_id → 不拉取模型列表', async () => {
    await getHandler('session:create')(null, { provider_id: 'p1', model_id: 'chosen' })

    expect(mockGetProviderModels).not.toHaveBeenCalled()
    expect(mockSessionCreate).toHaveBeenCalledWith(expect.objectContaining({ model_id: 'chosen' }))
  })
})
