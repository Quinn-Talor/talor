// src/shared/types/ipc.ts — IPC 协议边界上的共享类型
//
// 这些类型原本定义在 src/preload/index.ts 顶部,违反了"preload 脚本只做
// contextBridge 包装,不承担类型定义"的分层原则。搬到 shared 后:
//   - main、preload、renderer 三端共用同一份定义,不绕 preload 编译产物
//   - preload/index.ts 保留 re-export 兼容旧 import 路径,避免大规模改动
//
// 新代码请直接从 '@shared/types/ipc' 导入,不要再经 '../../preload/index'。

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'google'

// ── Model / Provider ─────────────────────────────────────────────────

export interface ModelInfo {
  id: string // provider_id/model_name, e.g., "ollama/qwen3:4b"
  name: string // Model name, e.g., "qwen3:4b"
  provider_id: string // Parent Provider ID
  display_name: string // Display name, e.g., "Qwen 3 (4B)"
  description?: string
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
  detected_at?: string // Detection timestamp (ISO)
  source: 'auto' | 'manual' | 'default'
}

export interface Provider {
  id: string
  type: ProviderType
  name: string
  base_url: string
  models: ModelInfo[]
  enabled: boolean
  is_default: boolean
  api_key?: string
  created_at: string
  updated_at: string
  models_last_updated?: string // ISO timestamp of last model list update
  models_cache_ttl?: number // Cache TTL in seconds (default: 300)
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
  models?: ModelInfo[]
  enabled: boolean
  is_default: boolean
  api_key?: string
}

export interface ConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  models_count?: number
  error_code?: string
  message?: string
}

// ── App config ───────────────────────────────────────────────────────

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
  default_context_limit?: number
  default_recent_ratio?: number
  default_summary_ratio?: number
}

// ── MCP ──────────────────────────────────────────────────────────────

export type MCPServerType = 'stdio' | 'http'

export interface MCPAuthConfig {
  type: 'none' | 'bearer' | 'apiKey'
  token?: string
  apiKey?: string
}

export interface MCPServer {
  id: string
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface MCPServerInput {
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled?: boolean
}

export interface MCPConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  tools_count?: number
  error_code?: 'TIMEOUT' | 'CONNECTION_FAILED' | 'INVALID_CONFIG' | 'AUTH_FAILED'
  message?: string
}

// ── Chat / Session ───────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatSession {
  id: string
  title: string
  provider_id: string
  model_id?: string
  workspace?: string
  agent_id: string
  parent_session_id?: string
  created_at: string
  updated_at: string
}

export interface ChatToolCallEvent {
  session_id: string
  message_id: string
  tool_call_id: string
  tool_name: string
  input: Record<string, unknown>
}

export interface ChatToolResultEvent {
  session_id: string
  message_id: string
  tool_call_id: string
  tool_name: string
  result: unknown
}

export interface SessionUpdateWorkspaceParams {
  session_id: string
  workspace: string
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

export interface SessionCheckModelAvailabilityResult {
  available: boolean
  model_id?: string
}
