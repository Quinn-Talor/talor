/**
 * Model management types for Talor Desktop
 * 
 * Note: Phase 1 focuses on model discovery and selection.
 * Model capability detection is deferred to Phase 2.
 */

export interface ModelInfo {
  id: string;                    // provider_id/model_name, e.g., "ollama/qwen3:4b"
  name: string;                  // Model name, e.g., "qwen3:4b"
  provider_id: string;           // Parent Provider ID
  display_name: string;          // Display name, e.g., "Qwen 3 (4B)"
  description?: string;          // Model description
  capabilities: ModelCapability[]; // Capability list (Phase 2: auto-detected)
  supports_vision?: boolean;     // Whether supports vision (Phase 2)
  supports_tools?: boolean;      // Whether supports tool calling (Phase 2)
  max_tokens?: number;           // Max token count (Phase 2)
  // Future extensions: pricing, performance metrics, etc.
}

export interface ModelCapability {
  category: 'text' | 'vision' | 'tools' | 'video' | 'audio';
  type: string;                  // e.g., "text_generation", "image_understanding"
  supported: boolean;            // Whether supported
  description: string;           // Capability description
  detected_at?: string;          // Detection timestamp (ISO)
  source: 'auto' | 'manual' | 'default'; // Source: auto-detected/manual/default
}

export interface ProviderModelResponse {
  models: ModelInfo[];
  refreshed_at: string;          // ISO timestamp
  cache_ttl: number;             // Cache TTL in seconds (default: 300)
}

export interface ModelListOptions {
  force_refresh?: boolean;       // Ignore cache and force refresh
  include_capabilities?: boolean; // Include capability details (Phase 2)
}

// Default capabilities for Phase 1 (simplified)
export const DEFAULT_MODEL_CAPABILITIES: ModelCapability[] = [
  {
    category: 'text',
    type: 'text_generation',
    supported: true,
    description: '文本生成',
    source: 'default'
  }
];

// Helper to create basic ModelInfo for Phase 1
export function createBasicModelInfo(
  id: string,
  name: string,
  provider_id: string,
  display_name: string,
  description?: string
): ModelInfo {
  return {
    id,
    name,
    provider_id,
    display_name,
    description,
    capabilities: DEFAULT_MODEL_CAPABILITIES,
    supports_vision: false,
    supports_tools: false
  };
}