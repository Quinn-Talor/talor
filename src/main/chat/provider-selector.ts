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

/** 按 id 取已启用的 provider;不存在或已禁用返回 null(禁用的 provider 不得被选用)。 */
export function getProviderById(id: string): Provider | null {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  const provider = providers[id]
  return provider && provider.enabled ? provider : null
}

/** session 中与 provider/model 选择相关的字段(主会话与子 agent 的父会话共用)。 */
export interface SessionModelRef {
  provider_id?: string | null
  model_id?: string | null
}

export interface ResolvedSessionModel {
  provider: Provider
  modelId: string
  /** true = session 指定的 provider 不可用(被删 / 禁用),已回落到默认 provider。 */
  fellBack: boolean
}

/**
 * session → (provider, modelId) 回落链:
 *   1. session.provider_id 指向的已启用 provider + session.model_id
 *      (session 未记录模型时取该 provider.models[0])
 *   2. 上述 provider 不可用 → 默认 provider;模型随之回落:session.model_id 恰在默认
 *      provider 的模型列表里则沿用,否则取其 models[0] —— 旧 provider 的模型 id
 *      发给新 provider 只会得到 model not found
 *   3. 仍无可用模型 → throw,由上层分类为错误回给前端
 */
export function resolveSessionProviderModel(
  session: SessionModelRef | null | undefined,
): ResolvedSessionModel {
  const sessionProvider = session?.provider_id ? getProviderById(session.provider_id) : null
  const sessionModelId = session?.model_id ?? undefined

  if (sessionProvider) {
    const modelId = sessionModelId ?? sessionProvider.models?.[0]?.id
    if (!modelId) throw new Error(`No model configured for provider ${sessionProvider.name}`)
    return { provider: sessionProvider, modelId, fellBack: false }
  }

  const provider = getDefaultProvider()
  const models = provider.models ?? []
  const modelId =
    sessionModelId && models.some((m) => m.id === sessionModelId || m.name === sessionModelId)
      ? sessionModelId
      : models[0]?.id
  if (!modelId) throw new Error(`No model configured for provider ${provider.name}`)
  return { provider, modelId, fellBack: Boolean(session?.provider_id) }
}

/**
 * profile.preferences.providerId 既可能是 UUID(从 UI 锁定具体 provider),
 * 也可能是 type 字符串(如 'anthropic',从模板/Crystallizer 内置 profile)。
 * 此函数同时支持两种查找方式 + model 配对校验:返回的 provider 必须已配置且
 * model 列表包含 modelId(若提供 modelId)。
 *
 * @param idOrType  Provider.id (UUID) 或 Provider.type ('anthropic'/'openai'/...)
 * @param modelId   要求该 provider 必须提供这个模型;若提供后没匹配到 → 返回 null
 *                  (调用方应 fallback 到 session/default,避免 model/provider 不匹配)
 * @returns 第一个匹配 + enabled 的 provider;无匹配返回 null
 */
export function findProviderByPreference(idOrType: string, modelId?: string): Provider | null {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>

  // 候选: 先按 UUID 主键匹配,再按 type 匹配(可能多个,取 enabled+default 优先)
  const byId = providers[idOrType] ?? null
  const candidates: Provider[] = byId
    ? [byId]
    : Object.values(providers).filter((p) => p.type === idOrType)

  // 配对校验: modelId 提供时,必须 candidate.models 中存在该 id
  for (const p of candidates) {
    if (!p.enabled) continue
    if (modelId && !p.models.some((m) => m.id === modelId)) continue
    return p
  }
  return null
}

/** 跨 provider 扫描:第一个 enabled 且 models 含 modelId 的 provider. */
export function findProviderByModel(modelId: string): Provider | null {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  for (const p of Object.values(providers)) {
    if (!p.enabled) continue
    if (p.models.some((m) => m.id === modelId)) return p
  }
  return null
}
