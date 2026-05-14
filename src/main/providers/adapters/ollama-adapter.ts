import { createOllama } from 'ollama-ai-provider-v2'
import { wrapLanguageModel } from 'ai'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { createBasicModelInfo } from '@shared/types/models'
import { buildSdkMiddlewares } from '../middleware'

export const ollamaAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const model = modelId.replace(/^ollama\//, '')
    const ollamaBase = `${baseUrl}/api`
    log.info('[ollama-adapter] baseURL:', ollamaBase, 'model:', model)
    const ollama = createOllama({ baseURL: ollamaBase })
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
