import { createAnthropic } from '@ai-sdk/anthropic'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'

export const anthropicAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^anthropic\//, '')
    log.info('[anthropic-adapter] baseURL:', baseUrl, 'model:', model)
    const anthropic = createAnthropic({ baseURL: baseUrl, apiKey })
    return anthropic(model)
  },

  async fetchModels(provider) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    }
    const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(10000) })
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 200)}`)
    }
    const data = (await res.json()) as { data?: { id?: string; display_name?: string }[] }
    return (data.data ?? [])
      .filter((m) => m.id)
      .map((m) =>
        createBasicModelInfo(
          `anthropic/${m.id}`,
          m.id!,
          provider.id,
          m.display_name ?? m.id!,
          'Anthropic model',
        ),
      )
  },

  buildStreamOptions() {
    return {}
  },
}
