/**
 * Model types for renderer (frontend) usage
 * Mirrors main process types but simplified for UI
 */

export interface ModelInfo {
  id: string;                    // provider_id/model_name, e.g., "ollama/qwen3:4b"
  name: string;                  // Model name, e.g., "qwen3:4b"
  provider_id: string;           // Parent Provider ID
  display_name: string;          // Display name, e.g., "Qwen 3 (4B)"
  description?: string;          // Model description
  capabilities: ModelCapability[]; // Capability list
  supports_vision?: boolean;     // Whether supports vision
  supports_tools?: boolean;      // Whether supports tool calling
  max_tokens?: number;           // Max token count
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
  refreshed_at: string;
  cache_ttl: number;
  from_cache: boolean;
}