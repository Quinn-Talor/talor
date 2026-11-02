// src/main/history/context-config.ts — 业务层(history)：会话 history 的上下文配置与模型窗口
//
// 职责：provider + 模型 → 上下文上限与摘要比例。resolveProviderConfig 原样迁自 prompt/PromptPipeline
// （旧路径的结果不变：未配上限时取全局设置）；引擎路径用 engineContextConfig，上限按模型的真实窗口取值：
// provider 的 context_limit → 已知模型窗口表 → 全局 default_context_limit → 128000（C3 BR-004）。
// 旧路径与引擎共用，不随旧路径删除。
//
// 允许依赖: store/config-store、electron-log
// 禁止依赖: ipc/*、memory/*、prompt/*、loop/*、chat/orchestrator

import log from 'electron-log'
import { ConfigStore, type Provider } from '../store/config-store'

export interface ProviderContextConfig {
  provider: Provider
  /** 会话实际使用的模型 id;memory 压缩等辅助 LLM 调用沿用该模型。 */
  modelId?: string
  context_limit: number
  recent_ratio: number
  summary_ratio: number
}

/**
 * Merges provider-level overrides with global defaults from ConfigStore.
 * `modelId` 为会话实际使用的模型,供 memory 压缩等辅助调用沿用。
 */
export function resolveProviderConfig(provider: Provider, modelId?: string): ProviderContextConfig {
  const configStore = ConfigStore.getInstance()
  const defaultLimit = configStore.get('default_context_limit') as number | undefined
  const defaultRecent = configStore.get('default_recent_ratio') as number | undefined
  const defaultSummary = configStore.get('default_summary_ratio') as number | undefined
  return {
    provider,
    ...(modelId ? { modelId } : {}),
    context_limit: provider.context_limit ?? defaultLimit ?? 1_000_000,
    recent_ratio: provider.recent_ratio ?? defaultRecent ?? 0.05,
    summary_ratio: provider.summary_ratio ?? defaultSummary ?? 0.05,
  }
}

/** 已知模型窗口：模型 id 转小写后按顺序匹配，取第一个命中的。 */
export const KNOWN_CONTEXT_WINDOWS: ReadonlyArray<{ match: string; tokens: number }> = [
  { match: 'deepseek', tokens: 128_000 },
  { match: 'claude', tokens: 200_000 },
  { match: 'gpt-4o', tokens: 128_000 },
  { match: 'gemini', tokens: 1_048_576 },
]

export const FALLBACK_CONTEXT_WINDOW = 128000

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** 模型的真实上下文窗口：provider 配置 → 已知窗口表 → 全局设置 → 128000。 */
export function modelContextWindow(provider: Provider, modelId: string): number {
  let value: number
  let source: 'provider' | 'known' | 'default' | 'fallback'
  const id = modelId.toLowerCase()
  const hit = KNOWN_CONTEXT_WINDOWS.find((w) => id.includes(w.match))
  const d = ConfigStore.getInstance().get('default_context_limit') as unknown
  if (positive(provider.context_limit)) {
    value = provider.context_limit
    source = 'provider'
  } else if (hit) {
    value = hit.tokens
    source = 'known'
  } else if (positive(d)) {
    value = d
    source = 'default'
  } else {
    value = FALLBACK_CONTEXT_WINDOW
    source = 'fallback'
  }
  log.debug(`[history] context window ${provider.id}/${modelId} = ${value} (${source})`)
  return value
}

/** 引擎路径的上下文配置：比例同 resolveProviderConfig，上限按模型窗口。 */
export function engineContextConfig(provider: Provider, modelId: string): ProviderContextConfig {
  return {
    ...resolveProviderConfig(provider, modelId),
    context_limit: modelContextWindow(provider, modelId),
  }
}
