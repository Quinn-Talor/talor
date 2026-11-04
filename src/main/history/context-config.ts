// src/main/history/context-config.ts — 业务层(history)：会话 history 的上下文配置与模型窗口
//
// 职责：provider + 模型 → 上下文上限与摘要比例。resolveProviderConfig 原样迁自 prompt/PromptPipeline
// （旧路径的结果不变：未配上限时取全局设置）；引擎的模型窗口 modelContextWindow 只取用户配置：
// provider 的 context_limit → 设置页的全局 default_context_limit → 128000（配置都缺失时）。
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

export const FALLBACK_CONTEXT_WINDOW = 128000

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** 模型的上下文窗口：provider 配置 → 全局设置 → 128000。 */
export function modelContextWindow(provider: Provider, modelId: string): number {
  let value: number
  let source: 'provider' | 'default' | 'fallback'
  const d = ConfigStore.getInstance().get('default_context_limit') as unknown
  if (positive(provider.context_limit)) {
    value = provider.context_limit
    source = 'provider'
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
