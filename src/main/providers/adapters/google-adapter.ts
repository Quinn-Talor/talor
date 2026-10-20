import { createGoogleGenerativeAI } from '@ai-sdk/google'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { wrapModel } from '../middleware'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'

export const googleAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^google\//, '')
    log.info('[google-adapter] baseURL:', baseUrl, 'model:', model)
    const google = createGoogleGenerativeAI({ baseURL: baseUrl, apiKey })
    const baseModel = google(model)
    // trace 中间件 + provider.middleware 配置的 SDK 中间件
    return wrapModel(baseModel, provider.middleware)
  },

  async fetchModels(provider) {
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
    if (!apiKey) throw new Error('Google API key required')
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      models?: { name?: string; displayName?: string; description?: string }[]
    }
    return (data.models ?? [])
      .filter((m) => m.name)
      .map((m) => {
        const id = m.name!.replace('models/', '')
        return createBasicModelInfo(
          `google/${id}`,
          id,
          provider.id,
          m.displayName ?? id,
          m.description ?? 'Google model',
        )
      })
  },

  buildStreamOptions() {
    return {}
  },

  applyReasoningConfig(config) {
    if (!config.enabled) {
      return { providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } }
    }
    return {
      providerOptions: {
        google: {
          thinkingConfig: { thinkingBudget: config.budgetTokens, thinkingLevel: config.effort },
        },
      },
    }
  },
}
