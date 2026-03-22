import { contextBridge, ipcRenderer } from 'electron'

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'google'

// Model types for IPC communication
export interface ModelInfo {
  id: string                    // provider_id/model_name, e.g., "ollama/qwen3:4b"
  name: string                  // Model name, e.g., "qwen3:4b"
  provider_id: string           // Parent Provider ID
  display_name: string          // Display name, e.g., "Qwen 3 (4B)"
  description?: string          // Model description
  capabilities: ModelCapability[] // Capability list
  supports_vision?: boolean     // Whether supports vision
  supports_tools?: boolean      // Whether supports tool calling
  max_tokens?: number           // Max token count
}

export interface ModelCapability {
  category: 'text' | 'vision' | 'tools' | 'video' | 'audio'
  type: string                  // e.g., "text_generation", "image_understanding"
  supported: boolean            // Whether supported
  description: string           // Capability description
  detected_at?: string          // Detection timestamp (ISO)
  source: 'auto' | 'manual' | 'default' // Source: auto-detected/manual/default
}

export interface Provider {
  id: string
  type: ProviderType
  name: string
  base_url: string
  models: ModelInfo[]           // Updated: ModelInfo objects instead of string array
  enabled: boolean
  is_default: boolean
  api_key?: string
  created_at: string
  updated_at: string
  // New fields for model caching
  models_last_updated?: string   // ISO timestamp of last model list update
  models_cache_ttl?: number      // Cache TTL in seconds (default: 300)
}

export interface ProviderModelResponse {
  models: ModelInfo[]
  refreshed_at: string
  cache_ttl: number
  from_cache: boolean
}

export interface ProviderInput {
  type: ProviderType
  name: string
  base_url: string
  models?: ModelInfo[]           // Updated: ModelInfo objects instead of string array
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

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatSession {
  id: string
  title: string
  provider_id: string
  model_id?: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string
  created_at: string
}

export interface Attachment {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
}

export type ChatErrorCode =
  | 'LLM_CONNECTION_FAILED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'LLM_ERROR'
  | 'LLM_TIMEOUT'
  | 'PROVIDER_NO_VISION'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_NOT_FOUND'
  | 'NETWORK_OFFLINE'

export interface ChatSendParams {
  session_id: string
  content: string
  attachments?: Attachment[]
}

export interface ChatSendResult {
  message_id: string
}

export interface ChatStreamEvent {
  session_id: string
  message_id: string
  delta: string
  done: boolean
  error_code?: ChatErrorCode
  error_message?: string
}

export interface SessionRenameParams {
  session_id: string
  title: string
}

export interface SessionUpdateModelParams {
  session_id: string
  model_id: string
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
    }): Promise<ConnectionTestResult> => ipcRenderer.invoke('providers:testConnection', config),
    getModels: (providerId: string, forceRefresh = false): Promise<ProviderModelResponse> =>
      ipcRenderer.invoke('providers:getModels', providerId, forceRefresh),
    refreshModels: (providerId: string): Promise<ProviderModelResponse> =>
      ipcRenderer.invoke('providers:refreshModels', providerId),
    detectCapabilities: (params: { providerId: string; modelId: string }): Promise<ModelInfo> =>
      ipcRenderer.invoke('providers:detectCapabilities', params),
    updateModelCapabilities: (params: { providerId: string; modelId: string; capabilities: ModelCapability[] }): Promise<ModelInfo> =>
      ipcRenderer.invoke('providers:updateModelCapabilities', params)
  },

  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized')
  },

  session: {
    list: (): Promise<ChatSession[]> => ipcRenderer.invoke('session:list'),
    create: (params: { provider_id: string; model_id?: string }): Promise<ChatSession> =>
      ipcRenderer.invoke('session:create', params),
    get: (id: string): Promise<ChatSession | null> => ipcRenderer.invoke('session:get', id),
    rename: (params: SessionRenameParams): Promise<ChatSession | null> =>
      ipcRenderer.invoke('session:rename', params),
    updateModel: (params: SessionUpdateModelParams): Promise<ChatSession | null> =>
      ipcRenderer.invoke('session:updateModel', params),
    delete: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:delete', sessionId),
    getMessages: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke('session:getMessages', sessionId),
    touch: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:touch', sessionId)
  },

  chat: {
    send: (params: ChatSendParams): Promise<ChatSendResult> =>
      ipcRenderer.invoke('chat:send', params),
    abort: (sessionId: string): Promise<void> => ipcRenderer.invoke('chat:abort', sessionId),
    onStream: (callback: (event: ChatStreamEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: ChatStreamEvent) => callback(data)
      ipcRenderer.on('chat:stream', handler)
      return () => ipcRenderer.removeListener('chat:stream', handler)
    }
  },

  file: {
    openDialog: (options?: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory' | 'dontAddToRecent'>
    }): Promise<string[] | null> =>
      ipcRenderer.invoke('file:openDialog', options)
  }
}

contextBridge.exposeInMainWorld('talorAPI', talorAPI)

export type TalorAPI = typeof talorAPI
