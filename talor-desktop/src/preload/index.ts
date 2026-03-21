import { contextBridge, ipcRenderer } from 'electron'

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'google'

export interface Provider {
  id: string
  type: ProviderType
  name: string
  base_url: string
  models: string[]
  enabled: boolean
  is_default: boolean
  api_key?: string
  created_at: string
  updated_at: string
}

export interface ProviderInput {
  type: ProviderType
  name: string
  base_url: string
  models?: string[]
  enabled: boolean
  is_default: boolean
  api_key?: string
}

export interface AppConfig {
  config_dir: string
  providers: Record<string, Provider>
  window_bounds: {
    width: number
    height: number
    x: number
    y: number
    is_maximized: boolean
  }
}

export interface ConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  models_count?: number
  error_code?: string
  message?: string
}

const talorAPI = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    save: (config: Partial<AppConfig>): Promise<void> => ipcRenderer.invoke('config:save', config)
  },

  providers: {
    list: (): Promise<Provider[]> => ipcRenderer.invoke('providers:list'),
    create: (provider: ProviderInput): Promise<Provider> =>
      ipcRenderer.invoke('providers:create', provider),
    update: (id: string, updates: ProviderInput): Promise<Provider> =>
      ipcRenderer.invoke('providers:update', id, updates),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('providers:delete', id),
    setDefault: (id: string): Promise<void> => ipcRenderer.invoke('providers:setDefault', id),
    testConnection: (config: {
      type: ProviderType
      base_url: string
      api_key?: string
    }): Promise<ConnectionTestResult> => ipcRenderer.invoke('providers:testConnection', config)
  },

  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized')
  }
}

contextBridge.exposeInMainWorld('talorAPI', talorAPI)

export type TalorAPI = typeof talorAPI
