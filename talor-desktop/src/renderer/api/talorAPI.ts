import type { ProviderType, ConnectionTestResult, Provider, ProviderInput } from '../types/config'

declare global {
  interface Window {
    talorAPI: {
      config: {
        get: () => Promise<{ config_dir: string; providers: Record<string, Provider>; window_bounds: unknown }>
        save: (config: unknown) => Promise<void>
      }
      providers: {
        list: () => Promise<Provider[]>
        create: (input: ProviderInput) => Promise<Provider>
        update: (id: string, updates: ProviderInput) => Promise<Provider>
        delete: (id: string) => Promise<void>
        setDefault: (id: string) => Promise<void>
        testConnection: (config: { type: ProviderType; base_url: string; api_key?: string }) => Promise<ConnectionTestResult>
      }
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
      }
    }
  }
}

// Use a Proxy so we lazily access window.talorAPI after the preload script has set it up.
// Eagerly assigning `window.talorAPI` at module load time fails because the preload
// script hasn't run yet — talorAPI would be undefined for every consumer.
export const talorAPI = new Proxy({} as Window['talorAPI'], {
  get(_target, prop) {
    if (!window.talorAPI) throw new Error(`talorAPI not ready (preload script missing)`)
    const value = (window.talorAPI as Record<string | symbol, unknown>)[prop]
    if (typeof value === 'function') return value.bind(window.talorAPI)
    return value
  }
})
