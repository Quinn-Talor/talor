import { createOpenAI } from '@ai-sdk/openai'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'

function createDeepSeekFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body)
        body.thinking = { type: 'disabled' }
        delete body.reasoning_effort
        init = { ...init, body: JSON.stringify(body) }
      } catch {
        /* not JSON, pass through */
      }
    }
    return baseFetch(input, init)
  }
}

function isNonOpenAI(baseUrl: string): boolean {
  return !baseUrl.includes('api.openai.com')
}

export const openaiAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^openai\//, '')
    log.info('[openai-adapter] baseURL:', baseUrl, 'model:', model)
    const opts: Parameters<typeof createOpenAI>[0] = { baseURL: `${baseUrl}/v1`, apiKey }
    if (isNonOpenAI(baseUrl)) {
      opts.fetch = createDeepSeekFetch()
    }
    const openai = createOpenAI(opts)
    return openai.chat(model)
  },

  async fetchModels(provider) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(10000) })
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 200)}`)
    }
    const data = (await res.json()) as { data?: { id?: string; owned_by?: string }[] }
    return (data.data ?? [])
      .filter((m) => m.id)
      .map((m) =>
        createBasicModelInfo(
          `openai/${m.id}`,
          m.id!,
          provider.id,
          m
            .id!.replace(/[:_-]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim(),
          m.owned_by ? `Owned by ${m.owned_by}` : 'OpenAI-compatible model',
        ),
      )
  },

  buildStreamOptions() {
    return {
      providerOptions: {
        openai: { parallelToolCalls: true },
      },
    }
  },
}
