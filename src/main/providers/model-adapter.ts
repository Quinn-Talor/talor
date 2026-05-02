// src/main/providers/model-adapter.ts — Provider 适配层
//
// 屏蔽不同 provider 的连接方式差异（baseURL、apiKey、SDK 调用方式）。
// Talor 内部只通过 getAdapter(providerType) 获取适配器，不直接 import @ai-sdk/* provider。

import type { LanguageModel } from 'ai'
import type { Provider } from '../store/config-store'
import type { ModelInfo } from '../types/models'
import { openaiAdapter } from './adapters/openai-adapter'
import { anthropicAdapter } from './adapters/anthropic-adapter'
import { googleAdapter } from './adapters/google-adapter'
import { ollamaAdapter } from './adapters/ollama-adapter'

export interface ModelAdapter {
  createModel(provider: Provider, modelId: string): LanguageModel
  fetchModels(provider: Provider): Promise<ModelInfo[]>
  buildStreamOptions(): Record<string, unknown>
}

export function getAdapter(providerType: string): ModelAdapter {
  switch (providerType) {
    case 'openai':
      return openaiAdapter
    case 'anthropic':
      return anthropicAdapter
    case 'google':
      return googleAdapter
    case 'ollama':
      return ollamaAdapter
    default:
      return openaiAdapter
  }
}
