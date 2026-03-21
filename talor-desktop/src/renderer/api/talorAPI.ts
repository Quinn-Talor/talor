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

export const talorAPI = window.talorAPI
