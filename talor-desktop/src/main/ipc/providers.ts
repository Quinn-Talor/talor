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
}
