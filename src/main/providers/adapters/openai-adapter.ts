import { createOpenAI } from '@ai-sdk/openai'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import type { Provider } from '../../store/config-store'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'
import { buildDisableThinkingFetch, shouldDisableThinking, wrapModel } from '../middleware'
import { buildAuthHeaders, modelsEndpoint, normalizeBaseUrl } from '../base-url'

function isNonOpenAI(apiBase: string): boolean {
  return !apiBase.includes('api.openai.com')
}

/**
 * 生效的 middleware 列表。未显式配置时,非 api.openai.com 的兼容端点(DeepSeek 等
 * 默认开 thinking 的服务)默认启用 'disable-thinking' —— 但用户开启推理时不启用,
 * 否则 fetch 拦截会删掉 reasoning_effort 并强写 thinking: disabled,推理配置失效。
 */
function resolveMiddlewareNames(provider: Provider, apiBase: string): string[] {
  if (provider.middleware) {
    return provider.reasoning?.enabled
      ? provider.middleware.filter((n) => n !== 'disable-thinking')
      : provider.middleware
  }
  if (provider.reasoning?.enabled) return []
  return isNonOpenAI(apiBase) ? ['disable-thinking'] : []
}

export const openaiAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const apiBase = normalizeBaseUrl('openai', provider.base_url)
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^openai\//, '')
    log.info('[openai-adapter] baseURL:', apiBase, 'model:', model)

    const middlewareNames = resolveMiddlewareNames(provider, apiBase)

    const opts: Parameters<typeof createOpenAI>[0] = { baseURL: apiBase, apiKey }
    if (shouldDisableThinking(middlewareNames)) {
      opts.fetch = buildDisableThinkingFetch()
    }
    const openaiClient = createOpenAI(opts)
    const baseModel = openaiClient.chat(model)

    // trace 中间件 + middlewareNames 中的 SDK 中间件(cost-tracking / request-logging 等)
    return wrapModel(baseModel, middlewareNames)
  },

  async fetchModels(provider) {
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
    const res = await fetch(modelsEndpoint('openai', provider.base_url), {
      headers: buildAuthHeaders('openai', apiKey),
      signal: AbortSignal.timeout(10000),
    })
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

  // 关闭推理时不下发 reasoning_effort:'none' 仅少数模型(GPT-5.1 起)接受,其他推理
  // 模型会 400;不传即用模型默认行为。兼容端点的"关思考"由 disable-thinking 拦截负责。
  applyReasoningConfig(config) {
    if (!config.enabled) return {}
    return {
      providerOptions: {
        openai: { reasoningEffort: config.effort ?? 'medium' },
      },
    }
  },
}
