// src/shared/types/models.ts — 跨进程共享:Provider 模型与能力描述
//
// 主进程（providers/、ipc/、store/）和渲染进程（components、pages、api）共用。
// 任何 ModelInfo / ModelCapability 跨 IPC 传递的字段定义都在这里。

export interface ModelInfo {
  id: string // provider_id/model_name, e.g., "ollama/qwen3:4b"
  name: string // Model name, e.g., "qwen3:4b"
  provider_id: string // Parent Provider ID
  display_name: string // Display name, e.g., "Qwen 3 (4B)"
  description?: string // Model description
  capabilities: ModelCapability[]
  supports_vision?: boolean
  supports_tools?: boolean
  max_tokens?: number
}

export interface ModelCapability {
  category: 'text' | 'vision' | 'tools' | 'video' | 'audio'
  type: string // e.g., "text_generation", "image_understanding"
  supported: boolean
  description: string
  detected_at?: string // ISO timestamp
  source: 'auto' | 'manual' | 'default'
}

export interface ProviderModelResponse {
  models: ModelInfo[]
  refreshed_at: string // ISO timestamp
  cache_ttl: number // seconds (default: 300)
  from_cache?: boolean // 渲染端区分缓存命中
}

export interface ModelListOptions {
  force_refresh?: boolean
  include_capabilities?: boolean
}

export const DEFAULT_MODEL_CAPABILITIES: ModelCapability[] = [
  {
    category: 'text',
    type: 'text_generation',
    supported: true,
    description: '文本生成',
    source: 'default',
  },
]

export function createBasicModelInfo(
  id: string,
  name: string,
  provider_id: string,
  display_name: string,
  description?: string,
): ModelInfo {
  return {
    id,
    name,
    provider_id,
    display_name,
    description,
    capabilities: DEFAULT_MODEL_CAPABILITIES,
    supports_vision: false,
    supports_tools: false,
  }
}
