import type { ModelInfo, ReasoningConfig } from '@shared/types/models'

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'google'

export interface Provider {
  id: string
  type: ProviderType
  name: string
  base_url: string
  models: ModelInfo[] // Updated: ModelInfo objects instead of string array
  enabled: boolean
  is_default: boolean
  api_key?: string
  created_at: string
  updated_at: string
  // New fields for model caching
  models_last_updated?: string // ISO timestamp of last model list update
  models_cache_ttl?: number // Cache TTL in seconds (default: 300)
  provider_options?: Record<string, unknown>
  middleware?: string[]
  reasoning?: ReasoningConfig
}

export interface ProviderInput {
  type: ProviderType
  name: string
  base_url: string
  models?: ModelInfo[] // Updated: ModelInfo objects instead of string array
  enabled: boolean
  is_default: boolean
  api_key?: string
  reasoning?: ReasoningConfig
}

export interface AppConfig {
  config_dir: string
  providers: Record<string, Provider>
  window_bounds: WindowBounds
}

export interface WindowBounds {
  width: number
  height: number
  x: number
  y: number
  is_maximized: boolean
}

export interface ConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  models_count?: number
  error_code?: string
  message?: string
}

export type TestStatus = 'idle' | 'testing' | 'success' | 'failure'

export type FormMode = 'closed' | 'creating' | 'editing'
