import { createAnthropic } from '@ai-sdk/anthropic'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { wrapModel } from '../middleware'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'

// Anthropic 的 thinking.budgetTokens 是原始数字,没有命名档位。effort 是
// Talor 跨 provider 的通用抽象,这里给它一个合理的默认映射,显式 budgetTokens
// 优先(见 applyReasoningConfig)。
const EFFORT_BUDGET_TOKENS: Record<'low' | 'medium' | 'high', number> = {
  low: 2048,
  medium: 4096,
  high: 8192,
}

export const anthropicAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^anthropic\//, '')
    log.info('[anthropic-adapter] baseURL:', baseUrl, 'model:', model)
    const anthropic = createAnthropic({ baseURL: baseUrl, apiKey })
    const baseModel = anthropic(model)
    // trace 中间件 + provider.middleware 配置的 SDK 中间件
    return wrapModel(baseModel, provider.middleware)
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

  applyReasoningConfig(config) {
    return {
      providerOptions: {
        anthropic: {
          thinking: config.enabled
            ? {
                type: 'enabled',
                budgetTokens:
                  config.budgetTokens ?? EFFORT_BUDGET_TOKENS[config.effort ?? 'medium'],
              }
            : { type: 'disabled' },
        },
      },
    }
  },
}
