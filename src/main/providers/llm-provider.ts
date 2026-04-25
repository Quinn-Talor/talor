import { openai } from '@ai-sdk/openai'
import log from 'electron-log'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { createOllama } from 'ollama-ai-provider-v2'
import type { LanguageModel } from 'ai'
import type { Provider } from '../store/config-store'

const modelCache = new Map<string, LanguageModel>()

export function createModel(provider: Provider, modelId: string | undefined): LanguageModel {
  const cacheKey = `${provider.id}:${modelId ?? 'default'}`
  const cached = modelCache.get(cacheKey)
  if (cached) return cached

  const baseUrl = provider.base_url.replace(/\/$/, '')
  const rawModel = modelId ?? provider.models?.[0]?.id ?? 'default'
  const model = rawModel.replace(new RegExp(`^${provider.type}/`), '')

  let instance: LanguageModel

  switch (provider.type) {
    case 'openai':
      instance = openai(model)
      break

    case 'anthropic':
      instance = anthropic(model)
      break

    case 'google':
      instance = google(model)
      break

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

