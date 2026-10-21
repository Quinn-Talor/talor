import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import log from 'electron-log'
import type { ModelAdapter } from '../model-adapter'
import { wrapModel } from '../middleware'
import { createBasicModelInfo } from '@shared/types/models'
import { normalizeBaseUrl, ollamaRootUrl } from '../base-url'

// Ollama 暴露 OpenAI 兼容端点(/v1)。改用官方 @ai-sdk/openai-compatible(基于
// @ai-sdk/provider v4,原生支持 ai@7),替代不再跟进 ai@7 的社区包
// ollama-ai-provider-v2。模型列表仍走 Ollama 原生 /api/tags。
export const ollamaAdapter: ModelAdapter = {
  createModel(provider, modelId) {
    const model = modelId.replace(/^ollama\//, '')
    const apiBase = normalizeBaseUrl('ollama', provider.base_url)
    log.info('[ollama-adapter] baseURL:', apiBase, 'model:', model)
    const ollama = createOpenAICompatible({ name: 'ollama', baseURL: apiBase })
    const baseModel = ollama(model)
    // trace 中间件 + provider.middleware 配置的 SDK 中间件
    return wrapModel(baseModel, provider.middleware)
  },

  async fetchModels(provider) {
    const res = await fetch(`${ollamaRootUrl(provider.base_url)}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    })
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

  // Ollama 的 /v1 兼容端点用 reasoning_effort 控制思考(`think` 只在其原生 API 生效,
  // 经 openai-compatible 透传到 /v1 会被忽略)。providerOptions.ollama.reasoningEffort
  // 由 SDK 映射为 reasoning_effort。关闭推理时不下发,保持模型默认,避免向不识别
  // 'none' 的模型发出非法取值。
  applyReasoningConfig(config) {
    if (!config.enabled) return {}
    return { providerOptions: { ollama: { reasoningEffort: config.effort ?? 'medium' } } }
  },
}
