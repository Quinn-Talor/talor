// src/main/providers/model-adapter.ts — Provider 适配层
//
// 屏蔽不同 provider 的连接方式差异（baseURL、apiKey、SDK 调用方式）。
// Talor 内部只通过 getAdapter(providerType) 获取适配器，不直接 import @ai-sdk/* provider。

import type { LanguageModel } from 'ai'
import type { Provider } from '../store/config-store'
import type { ModelInfo, ReasoningConfig } from '@shared/types/models'
import { openaiAdapter } from './adapters/openai-adapter'
import { anthropicAdapter } from './adapters/anthropic-adapter'
import { googleAdapter } from './adapters/google-adapter'
import { ollamaAdapter } from './adapters/ollama-adapter'

export interface ModelAdapter {
  createModel(provider: Provider, modelId: string): LanguageModel
  fetchModels(provider: Provider): Promise<ModelInfo[]>
  buildStreamOptions(): Record<string, unknown>
  /** 可选：把用户的 ReasoningConfig 翻译成该 provider 的 providerOptions 片段。 */
  applyReasoningConfig?(config: ReasoningConfig, provider: Provider): Record<string, unknown>
}

/**
 * 按 provider-key 逐层合并多个 streamOptions 片段的 providerOptions。
 * providerOptions 是 {[providerKey]: {...fields}} 嵌套结构，顶层 spread 会让
 * 后者整体替换某个 provider-key 的值，必须逐 key 合并内层字段（BR-002）。
 */
export function mergeProviderOptions(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const merged: Record<string, Record<string, unknown>> = {}
  for (const src of sources) {
    if (!src) continue
    const po = (src.providerOptions ?? {}) as Record<string, Record<string, unknown>>
    for (const [providerKey, fields] of Object.entries(po)) {
      merged[providerKey] = { ...merged[providerKey], ...fields }
    }
  }
  return { providerOptions: merged }
}

/** 组装最终 streamOptions：adapter 默认值 + reasoning 翻译（如有）。 */
export function resolveStreamOptions(
  adapter: ModelAdapter,
  provider: Provider,
): Record<string, unknown> {
  const base = adapter.buildStreamOptions()
  if (!provider.reasoning || !adapter.applyReasoningConfig) return base
  const reasoningOpts = adapter.applyReasoningConfig(provider.reasoning, provider)
  return mergeProviderOptions(base, reasoningOpts)
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
