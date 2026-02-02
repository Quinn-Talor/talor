/**
 * API Module Exports
 * API 模块导出
 *
 * Re-exports all API client classes and types for convenient importing.
 * Updated to include all new OpenCode-compatible API modules.
 */

// Client exports
export {
  TalorClient,
  type TalorClientConfig,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ServerError,
} from './client';

// Session API exports
export {
  createSessionApi,
  type SessionApi,
  type CreateSessionRequest,
  type ListSessionsParams,
  type GetMessagesParams,
} from './session';

// Agent API exports
export {
  createAgentApi,
  type AgentApi,
  type AgentInfo,
  parseSSEChunk,
  parseSSEDataLine,
} from './agent';

// Provider API exports
export {
  createProviderApi,
  type ProviderApi,
  type ProviderInfo,
  type ModelInfo,
  type FullModelInfo,
} from './provider';

// MCP API exports
export {
  createMCPApi,
  type MCPApi,
  type MCPServerInfo,
  type MCPServerConfig,
  type MCPServerStatus,
  type MCPToolInfo,
} from './mcp';

// Config API exports
export {
  createConfigApi,
  type ConfigApi,
  type AppConfig,
  type ConfigScope,
} from './config';

// Events API exports
export {
  createEventsApi,
  type EventsApi,
  type EventsApiConfig,
  ConnectionError,
  type ConnectionState,
  type ConnectionStateHandler,
  parseSSEEvent,
  calculateRetryDelay,
} from './events';

// Default export
export { default } from './client';
