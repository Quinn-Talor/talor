// src/main/history/context-config.ts — 业务层(history)：引擎的模型上下文窗口
//
// modelContextWindow 只取用户配置：provider 的 context_limit → 设置页的全局 default_context_limit
// → 128000（配置都缺失时）。
//
// 允许依赖: store/config-store、electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import { ConfigStore, type Provider } from '../store/config-store'

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
