import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { SafeStorageService } from '../../services/safe-storage'
import { createBasicModelInfo } from '@shared/types/models'
import {
  buildDisableThinkingFetch,
  buildSdkMiddlewares,
  shouldDisableThinking,
} from '../middleware'

function isNonOpenAI(baseUrl: string): boolean {
  return !baseUrl.includes('api.openai.com')
}

export const openaiAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined
    const model = modelId.replace(/^openai\//, '')
    log.info('[openai-adapter] baseURL:', baseUrl, 'model:', model)

    // v4 Phase 1: 走 middleware 启用列表
    // 'disable-thinking' middleware (fetch 拦截路径) — 非 OpenAI baseURL 默认启用 (兼容旧行为)
    // 用户也可以通过 provider.middleware 显式控制
    const middlewareNames =
      provider.middleware ?? (isNonOpenAI(baseUrl) ? ['disable-thinking'] : [])

    const opts: Parameters<typeof createOpenAI>[0] = { baseURL: `${baseUrl}/v1`, apiKey }
    if (shouldDisableThinking(middlewareNames)) {
      opts.fetch = buildDisableThinkingFetch()
    }
    const openaiClient = createOpenAI(opts)
    const baseModel = openaiClient.chat(model)

    // v4 Phase 1: 叠加 SDK middleware (cost-tracking / request-logging 等)
    const sdkMiddlewares = buildSdkMiddlewares(middlewareNames)
    if (sdkMiddlewares.length === 0) return baseModel
    return wrapLanguageModel({ model: baseModel, middleware: sdkMiddlewares })
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
