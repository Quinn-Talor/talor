// src/main/ipc/providers.ts —— 入口层：provider IPC handlers
// 允许依赖：providers/*（provider-fetcher 等基础能力）、services/safe-storage、store/*、shared/*

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { ConfigStore } from '../store/config-store'
import type { Provider, ProviderInput } from '../store/config-store'
import { testConnection, ProviderType } from '../providers/provider-tester'
import { SafeStorageService } from '../services/safe-storage'
import log from 'electron-log'
import type { ModelInfo } from '@shared/types/models'

/**
 * 把拉到的模型列表写回单个 provider。拉取要 await 网络,期间用户可能改/删了别的 provider,
 * 所以必须 await 之后重新读 store 并只合并目标 provider,不能整表回写旧快照。
 * 目标 provider 已被删除时不写(避免“复活”)。
 */
function saveFetchedModels(providerId: string, models: ModelInfo[], refreshedAt: string): void {
  const store = ConfigStore.getInstance()
  const latest = store.get('providers') ?? {}
  const current = latest[providerId]
  if (!current) return
  latest[providerId] = {
    ...current,
    models,
    models_last_updated: refreshedAt,
    models_cache_ttl: current.models_cache_ttl ?? 300,
  }
  store.set('providers', latest)
}

export function registerProviderHandlers(): void {
  ipcMain.handle('providers:list', () => {
    const providers = ConfigStore.getInstance().get('providers') ?? {}
    return Object.values(providers)
  })

  ipcMain.handle('providers:create', (_event, input: ProviderInput) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}
    const now = new Date().toISOString()
    const id = uuidv4()
    const apiKey = input.api_key ?? ''

    const provider: Provider = {
      id,
      type: input.type,
      name: input.name,
      base_url: input.base_url,
      enabled: input.enabled,
      is_default: input.is_default,
      supports_vision: input.supports_vision ?? false,
      models: input.models ?? [],
      created_at: now,
      updated_at: now,
      reasoning: input.reasoning,
    }

    if (apiKey) {
      SafeStorageService.getInstance().setApiKey(id, apiKey)
    }

    providers[id] = provider
    store.set('providers', providers)

    return provider
  })

  ipcMain.handle('providers:update', (_event, id: string, updates: ProviderInput) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}

    if (!providers[id]) {
      throw new Error(`Provider not found: ${id}`)
    }

    const apiKey = updates.api_key ?? ''
    const hasNewKey = updates.api_key !== undefined

    if (hasNewKey && apiKey) {
      SafeStorageService.getInstance().setApiKey(id, apiKey)
    }

    const { api_key: _ek, ...restUpdates } = updates
    providers[id] = {
      ...providers[id],
      type: restUpdates.type ?? providers[id].type,
      name: restUpdates.name ?? providers[id].name,
      base_url: restUpdates.base_url ?? providers[id].base_url,
      enabled: restUpdates.enabled ?? providers[id].enabled,
      is_default: restUpdates.is_default ?? providers[id].is_default,
      supports_vision: restUpdates.supports_vision ?? providers[id].supports_vision,
      models: restUpdates.models ?? providers[id].models,
      reasoning: restUpdates.reasoning ?? providers[id].reasoning,
      updated_at: new Date().toISOString(),
    }

    store.set('providers', providers)
    return providers[id]
  })

  ipcMain.handle('providers:delete', (_event, id: string) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}

    if (providers[id]) {
      delete providers[id]
      SafeStorageService.getInstance().removeApiKey(id)
      store.set('providers', providers)
    }
  })

  ipcMain.handle('providers:setDefault', (_event, id: string) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}

    const updatedProviders: Record<string, Provider> = {}
    for (const [pid, provider] of Object.entries(providers)) {
      updatedProviders[pid] = {
        ...provider,
        is_default: pid === id,
      }
    }

    store.set('providers', updatedProviders)
  })

  ipcMain.handle(
    'providers:testConnection',
    (
      _event,
      config: { type: ProviderType; base_url: string; api_key?: string; provider_id?: string },
    ) => {
      const { provider_id, ...testConfig } = config
      // 已存 provider 的 key 只在 SafeStorage,不回传渲染端;未显式给 key 时按 id 取已存 key
      const apiKey =
        testConfig.api_key ||
        (provider_id
          ? (SafeStorageService.getInstance().getApiKey(provider_id) ?? undefined)
          : undefined)
      return testConnection({ ...testConfig, api_key: apiKey })
    },
  )

  // New endpoints for model management
  ipcMain.handle(
    'providers:getModels',
    async (_event, providerId: string, forceRefresh = false) => {
      const store = ConfigStore.getInstance()
      const providers = store.get('providers') ?? {}
      const provider = providers[providerId]

      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`)
      }

      try {
        const { getProviderModels, isCacheValid } = await import('../providers/provider-fetcher')

        if (
          !forceRefresh &&
          isCacheValid(provider.models_last_updated) &&
          (provider.models?.length ?? 0) > 0
        ) {
          return {
            models: provider.models,
            refreshed_at: provider.models_last_updated,
            cache_ttl: provider.models_cache_ttl ?? 300,
            from_cache: true,
          }
        }

        const models = await getProviderModels(provider, forceRefresh)

        const now = new Date().toISOString()
        saveFetchedModels(providerId, models, now)

        return {
          models,
          refreshed_at: now,
          cache_ttl: provider.models_cache_ttl ?? 300,
          from_cache: false,
        }
      } catch (error) {
        // 拉取失败(provider 离线等)但有旧列表时回退旧列表,不让一个不可达的 provider
        // 把模型选择整体打空;显式刷新(refreshModels / forceRefresh)仍报错。
        if (!forceRefresh && (provider.models?.length ?? 0) > 0) {
          log.warn('[providers:getModels] fetch failed, serving stale models:', providerId, error)
          return {
            models: provider.models,
            refreshed_at: provider.models_last_updated,
            cache_ttl: provider.models_cache_ttl ?? 300,
            from_cache: true,
          }
        }
        throw new Error(
          `Failed to get models for provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
  )

  ipcMain.handle('providers:refreshModels', async (_event, providerId: string) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}
    const provider = providers[providerId]

    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    try {
      const { getProviderModels } = await import('../providers/provider-fetcher')
      const models = await getProviderModels(provider, true)

      const now = new Date().toISOString()
      saveFetchedModels(providerId, models, now)

      return {
        models,
        refreshed_at: now,
        cache_ttl: provider.models_cache_ttl ?? 300,
      }
    } catch (error) {
      throw new Error(
        `Failed to refresh models for provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  ipcMain.handle(
    'providers:detectCapabilities',
    async (_event, params: { providerId: string; modelId: string }) => {
      const store = ConfigStore.getInstance()
      const providers = store.get('providers') ?? {}
      const provider = providers[params.providerId]

      if (!provider) {
        throw new Error(`Provider not found: ${params.providerId}`)
      }

      const model = provider.models?.find((m) => m.id === params.modelId)
      if (!model) {
        throw new Error(`Model not found: ${params.modelId}`)
      }

      const { detectModelCapabilities, getCapabilitiesWithFallback } =
        await import('../providers/capability/detector')
      const capabilities = getCapabilitiesWithFallback(() => detectModelCapabilities(model))

      const updatedModel = {
        ...model,
        capabilities,
        supports_vision: capabilities.some((c) => c.type === 'image_understanding' && c.supported),
        supports_tools: capabilities.some((c) => c.type === 'function_calling' && c.supported),
      }

      const updatedModels = (provider.models ?? []).map((m) =>
        m.id === params.modelId ? updatedModel : m,
      )
      providers[params.providerId] = {
        ...provider,
        models: updatedModels,
      }
      store.set('providers', providers)

      return updatedModel
    },
  )

  ipcMain.handle(
    'providers:updateModelCapabilities',
    async (
      _event,
      params: {
        providerId: string
        modelId: string
        capabilities: import('@shared/types/models').ModelCapability[]
      },
    ) => {
      const store = ConfigStore.getInstance()
      const providers = store.get('providers') ?? {}
      const provider = providers[params.providerId]

      if (!provider) {
        throw new Error(`Provider not found: ${params.providerId}`)
      }

      const model = provider.models?.find((m) => m.id === params.modelId)
      if (!model) {
        throw new Error(`Model not found: ${params.modelId}`)
      }

      const { applyManualCapabilities } = await import('../providers/capability/updater')
      const manualCapabilities = applyManualCapabilities(params.capabilities)

      const updatedModel = {
        ...model,
        capabilities: manualCapabilities,
        supports_vision: manualCapabilities.some(
          (c) => c.type === 'image_understanding' && c.supported,
        ),
        supports_tools: manualCapabilities.some(
          (c) => c.type === 'function_calling' && c.supported,
        ),
      }

      const updatedModels = (provider.models ?? []).map((m) =>
        m.id === params.modelId ? updatedModel : m,
      )
      providers[params.providerId] = {
        ...provider,
        models: updatedModels,
      }
      store.set('providers', providers)

      return updatedModel
    },
  )
}
