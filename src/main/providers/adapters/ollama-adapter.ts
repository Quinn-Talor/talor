import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wrapLanguageModel } from 'ai'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { createBasicModelInfo } from '@shared/types/models'
import { buildSdkMiddlewares } from '../middleware'

// Ollama 暴露 OpenAI 兼容端点(/v1)。改用官方 @ai-sdk/openai-compatible(基于
// @ai-sdk/provider v4,原生支持 ai@7),替代不再跟进 ai@7 的社区包
// ollama-ai-provider-v2。模型列表仍走 Ollama 原生 /api/tags。
export const ollamaAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const model = modelId.replace(/^ollama\//, '')
    const apiBase = `${baseUrl}/v1`
    log.info('[ollama-adapter] baseURL:', apiBase, 'model:', model)
    const ollama = createOpenAICompatible({ name: 'ollama', baseURL: apiBase })
    const baseModel = ollama(model)
    // v4 Phase 1: SDK middleware
    const sdkMiddlewares = buildSdkMiddlewares(provider.middleware)
    if (sdkMiddlewares.length === 0) return baseModel
    return wrapLanguageModel({ model: baseModel, middleware: sdkMiddlewares })
  },

  async fetchModels(provider) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 200)}`)
    }
    const data = (await res.json()) as { models?: { name?: string }[] }
    return (data.models ?? [])
      .filter((m) => m.name)
      .map((m) =>
        createBasicModelInfo(
          `ollama/${m.name}`,
          m.name!,
          provider.id,
          m
            .name!.replace(/[:_-]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim(),
          `Ollama model: ${m.name}`,
        ),
      )
  },

  buildStreamOptions() {
    return {}
  },
}
