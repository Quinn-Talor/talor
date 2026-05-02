import { createOpenAI } from '@ai-sdk/openai'
import log from 'electron-log'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOllama } from 'ollama-ai-provider-v2'
import type { LanguageModel } from 'ai'
import type { Provider } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'

const modelCache = new Map<string, LanguageModel>()

export function createModel(provider: Provider, modelId: string | undefined): LanguageModel {
  const cacheKey = `${provider.id}:${modelId ?? 'default'}`
  const cached = modelCache.get(cacheKey)
  if (cached) return cached

  const baseUrl = provider.base_url.replace(/\/$/, '')
  const rawModel = modelId ?? provider.models?.[0]?.id ?? 'default'
  const model = rawModel.replace(new RegExp(`^${provider.type}/`), '')

  let instance: LanguageModel

  const apiKey = SafeStorageService.getInstance().getApiKey(provider.id) ?? undefined

  switch (provider.type) {
    case 'openai': {
      log.info('[createModel] openai baseURL:', baseUrl, 'model:', model)
      const openaiProvider = createOpenAI({ baseURL: `${baseUrl}/v1`, apiKey })
      instance = openaiProvider.chat(model)
      break
    }

    case 'anthropic': {
      log.info('[createModel] anthropic baseURL:', baseUrl, 'model:', model)
      const anthropicProvider = createAnthropic({ baseURL: `${baseUrl}`, apiKey })
      instance = anthropicProvider(model)
      break
    }

    case 'google': {
      log.info('[createModel] google baseURL:', baseUrl, 'model:', model)
      const googleProvider = createGoogleGenerativeAI({ baseURL: `${baseUrl}`, apiKey })
      instance = googleProvider(model)
      break
    }

    case 'ollama': {
      const ollamaBase = `${baseUrl}/api`
      log.info('[createModel] ollama baseURL:', ollamaBase, 'model:', model)
      const ollamaProvider = createOllama({ baseURL: ollamaBase })
      instance = ollamaProvider(model)
      break
    }

    default:
      throw new Error(`Unsupported provider type: ${(provider as Provider).type}`)
  }

  modelCache.set(cacheKey, instance)
  return instance
}

export function clearModelCache(): void {
  modelCache.clear()
}
