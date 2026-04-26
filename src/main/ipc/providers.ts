// src/main/ipc/providers.ts —— 入口层：provider IPC handlers
// 允许依赖：services/*（provider-fetcher 等基础能力）、store/*、shared/*

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { ConfigStore } from '../store/config-store'
import type { Provider, ProviderInput } from '../store/config-store'
import { testConnection, ProviderType } from '../services/provider-tester'
import { SafeStorageService } from '../services/safe-storage'

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
      updated_at: now
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
      updated_at: new Date().toISOString()
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
        is_default: pid === id
      }
    }

    store.set('providers', updatedProviders)
  })

  ipcMain.handle(
    'providers:testConnection',
    (_event, config: { type: ProviderType; base_url: string; api_key?: string }) => {
      return testConnection(config)
    }
  )

  // New endpoints for model management
  ipcMain.handle('providers:getModels', async (_event, providerId: string, forceRefresh = false) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}
    const provider = providers[providerId]
    
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    try {
      const { getProviderModels, isCacheValid } = await import('../services/provider-fetcher')

      if (!forceRefresh && isCacheValid(provider.models_last_updated) && (provider.models?.length ?? 0) > 0) {
        return {
          models: provider.models,
          refreshed_at: provider.models_last_updated,
          cache_ttl: provider.models_cache_ttl ?? 300,
          from_cache: true
        }
      }

      const models = await getProviderModels(provider, forceRefresh)
      
      const now = new Date().toISOString()
      providers[providerId] = {
        ...provider,
        models,
        models_last_updated: now,
        models_cache_ttl: provider.models_cache_ttl ?? 300
      }
      store.set('providers', providers)
      
      return {
        models,
        refreshed_at: now,
        cache_ttl: provider.models_cache_ttl ?? 300,
        from_cache: false
      }
    } catch (error) {
      throw new Error(`Failed to get models for provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ipcMain.handle('providers:refreshModels', async (_event, providerId: string) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}
    const provider = providers[providerId]
    
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    try {
      const { getProviderModels } = await import('../services/provider-fetcher')
      const models = await getProviderModels(provider, true)
      
      const now = new Date().toISOString()
      providers[providerId] = {
        ...provider,
        models,
        models_last_updated: now,
        models_cache_ttl: provider.models_cache_ttl ?? 300
      }
      store.set('providers', providers)
      
      return {
        models,
        refreshed_at: now,
        cache_ttl: provider.models_cache_ttl ?? 300
      }
    } catch (error) {
      throw new Error(`Failed to refresh models for provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ipcMain.handle('providers:detectCapabilities', async (_event, params: { providerId: string; modelId: string }) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}
    const provider = providers[params.providerId]

    if (!provider) {
      throw new Error(`Provider not found: ${params.providerId}`)
    }

    const model = provider.models?.find(m => m.id === params.modelId)
    if (!model) {
      throw new Error(`Model not found: ${params.modelId}`)
    }

    const { detectModelCapabilities, getCapabilitiesWithFallback } = await import('../services/capability-detector')
    const capabilities = getCapabilitiesWithFallback(() => detectModelCapabilities(model))

    const updatedModel = {
      ...model,
      capabilities,
      supports_vision: capabilities.some(c => c.type === 'image_understanding' && c.supported),
      supports_tools: capabilities.some(c => c.type === 'function_calling' && c.supported),
    }

    const updatedModels = (provider.models ?? []).map(m => m.id === params.modelId ? updatedModel : m)
    providers[params.providerId] = {
      ...provider,
      models: updatedModels,
    }
    store.set('providers', providers)

    return updatedModel
  })

  ipcMain.handle('providers:updateModelCapabilities', async (_event, params: { providerId: string; modelId: string; capabilities: import('../types/models').ModelCapability[] }) => {
    const store = ConfigStore.getInstance()
    const providers = store.get('providers') ?? {}
    const provider = providers[params.providerId]

    if (!provider) {
      throw new Error(`Provider not found: ${params.providerId}`)
    }

    const model = provider.models?.find(m => m.id === params.modelId)
    if (!model) {
      throw new Error(`Model not found: ${params.modelId}`)
    }

    const { applyManualCapabilities } = await import('../services/capability-updater')
    const manualCapabilities = applyManualCapabilities(params.capabilities)

    const updatedModel = {
      ...model,
      capabilities: manualCapabilities,
      supports_vision: manualCapabilities.some(c => c.type === 'image_understanding' && c.supported),
      supports_tools: manualCapabilities.some(c => c.type === 'function_calling' && c.supported),
    }

    const updatedModels = (provider.models ?? []).map(m => m.id === params.modelId ? updatedModel : m)
    providers[params.providerId] = {
      ...provider,
      models: updatedModels,
    }
    store.set('providers', providers)

    return updatedModel
  })
}
