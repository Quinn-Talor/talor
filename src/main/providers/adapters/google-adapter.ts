import { createGoogleGenerativeAI } from '@ai-sdk/google'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { wrapModel } from '../middleware'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'
import { buildAuthHeaders, modelsEndpoint, normalizeBaseUrl } from '../base-url'
import { buildMergeUserTurnsFetch, googleSystemNoteMiddleware } from './google-message-compat'

/** Gemini 3.x 用 thinkingLevel;2.5 及更早用 thinkingBudget(SDK 顶层 reasoning 按此映射)。 */
function isGemini3(modelId: string | undefined): boolean {
  return !!modelId && /gemini-3(?:[.-]|$)/i.test(modelId)
}

/** 只能在思考模式下运行的模型:thinkingBudget=0 会被拒绝,关闭推理时不下发参数。 */
function isThinkingOnly(modelId: string | undefined): boolean {
  return !!modelId && /gemini-2\.5-pro/i.test(modelId)
}

export const googleAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const apiBase = normalizeBaseUrl('google', provider.base_url)
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^google\//, '')
    log.info('[google-adapter] baseURL:', apiBase, 'model:', model)
    const google = createGoogleGenerativeAI({
      baseURL: apiBase,
      apiKey,
      fetch: buildMergeUserTurnsFetch(),
    })
    const baseModel = google(model)
    // trace 中间件 + provider.middleware 配置的 SDK 中间件 + Gemini 消息形态适配
    return wrapModel(baseModel, provider.middleware, [googleSystemNoteMiddleware])
  },

  async fetchModels(provider) {
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
    if (!apiKey) throw new Error('Google API key required')
    const res = await fetch(modelsEndpoint('google', provider.base_url), {
      headers: buildAuthHeaders('google', apiKey),
      signal: AbortSignal.timeout(10000),
    })
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

  // 档位走 AI SDK 顶层 reasoning,由 SDK 按模型版本映射(2.5 → thinkingBudget,
  // 3.x → thinkingLevel);显式 budgetTokens 只对按预算计的 2.5 系有意义。
  applyReasoningConfig(config, _provider, modelId) {
    const model = modelId?.replace(/^google\//, '')
    if (!config.enabled) {
      return isThinkingOnly(model) ? {} : { reasoning: 'none' }
    }
    if (config.budgetTokens !== undefined && !isGemini3(model)) {
      return {
        providerOptions: { google: { thinkingConfig: { thinkingBudget: config.budgetTokens } } },
      }
    }
    return { reasoning: config.effort ?? 'medium' }
  },
}
