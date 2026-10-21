import { createAnthropic } from '@ai-sdk/anthropic'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { wrapModel } from '../middleware'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'
import { buildAuthHeaders, modelsEndpoint, normalizeBaseUrl } from '../base-url'

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
    // SDK baseURL 需带 /v1(其后直接拼 /messages)
    const apiBase = normalizeBaseUrl('anthropic', provider.base_url)
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^anthropic\//, '')
    log.info('[anthropic-adapter] baseURL:', apiBase, 'model:', model)
    const anthropic = createAnthropic({ baseURL: apiBase, apiKey })
    const baseModel = anthropic(model)
    // trace 中间件 + provider.middleware 配置的 SDK 中间件
    return wrapModel(baseModel, provider.middleware)
  },

  async fetchModels(provider) {
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
    const res = await fetch(modelsEndpoint('anthropic', provider.base_url), {
      headers: buildAuthHeaders('anthropic', apiKey),
      signal: AbortSignal.timeout(10000),
    })
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
