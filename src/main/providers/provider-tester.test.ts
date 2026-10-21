import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { testConnection } from './provider-tester'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

describe('testConnection', () => {
  it('anthropic:x-api-key + anthropic-version 鉴权,模型数取 data 字段,不重复拼 /v1', async () => {
    fetchMock.mockResolvedValue(okJson({ data: [{ id: 'a' }, { id: 'b' }] }))
    const r = await testConnection({
      type: 'anthropic',
      base_url: 'https://api.anthropic.com/v1',
      api_key: 'k',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/models')
    expect(init.headers).toEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
    expect(r).toMatchObject({ status: 'success', models_count: 2 })
  })

  it('google:x-goog-api-key 鉴权,走 /v1beta/models', async () => {
    fetchMock.mockResolvedValue(okJson({ models: [{ name: 'models/x' }] }))
    const r = await testConnection({
      type: 'google',
      base_url: 'https://generativelanguage.googleapis.com',
      api_key: 'k',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(init.headers).toEqual({ 'x-goog-api-key': 'k' })
    expect(r).toMatchObject({ status: 'success', models_count: 1 })
  })

  it('openai:Bearer 鉴权,填了 /v1 也不会变成 /v1/v1(不触发)', async () => {
    fetchMock.mockResolvedValue(okJson({ data: [{ id: 'gpt' }] }))
    await testConnection({ type: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'k' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect(init.headers).toEqual({ Authorization: 'Bearer k' })
  })

  it('401 → AUTH_FAILED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const r = await testConnection({ type: 'openai', base_url: 'https://x', api_key: 'bad' })
    expect(r).toMatchObject({ status: 'failure', error_code: 'AUTH_FAILED' })
  })
})
