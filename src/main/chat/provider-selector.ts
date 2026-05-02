// src/main/chat/provider-selector.ts —— 业务层（chat 领域）：默认 provider 选取
//
// 允许依赖：store/*
// 禁止依赖：ipc/*

import { ConfigStore, type Provider } from '../store/config-store'

/**
 * 选择默认 LLM provider。
 *
 * 选择优先级：
 *   1. is_default=true 且 enabled=true —— 用户在 UI 勾选的默认项
 *   2. 任一 enabled=true —— 默认项被禁用时的兜底
 *   3. throw "No provider available" —— 让上层把它分类为 LLM_ERROR 回给前端
 *
 * 返回的 Provider 完整字段来自 electron-store；调用方通常只关心 id / type / base_url。
 */
export function getDefaultProvider(): Provider {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  const defaults = Object.values(providers).filter((p) => p.is_default && p.enabled)
  if (defaults.length > 0) return defaults[0]
  const enabled = Object.values(providers).filter((p) => p.enabled)
  if (enabled.length > 0) return enabled[0]
  throw new Error('No provider available')
}

export function getProviderById(id: string): Provider | null {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  return providers[id] ?? null
}
