/**
 * API Module Exports
 * API 模块导出
 *
 * Re-exports all API client classes and types for convenient importing.
 */

// Client exports
export {
    AuthenticationError, NetworkError, NotFoundError,
    ServerError, TalorClient,
    type TalorClientConfig
} from './client';

// Session API exports
export {
    createSessionApi, type CreateSessionRequest, type GetMessagesParams, type ListSessionsParams, type SessionApi
} from './session';

// Agent API exports
export {
    createAgentApi, parseSSEChunk,
    parseSSEDataLine, type AgentApi,
    type AgentInfo
} from './agent';

// Provider API exports
export {
    createProviderApi, type FullModelInfo, type ModelInfo, type ProviderApi,
    type ProviderInfo
} from './provider';

// MCP API exports
export {
    createMCPApi,
    type MCPApi, type MCPServerConfig, type MCPServerInfo, type MCPServerStatus,
    type MCPToolInfo
} from './mcp';

// Config API exports
export {
    createConfigApi, type AppConfig, type ConfigApi, type ConfigScope
} from './config';

// Events API exports
export {
    ConnectionError, calculateRetryDelay, createEventsApi, parseSSEEvent, type ConnectionState,
    type ConnectionStateHandler, type EventsApi,
    type EventsApiConfig
} from './events';

// Default export
export { default } from './client';
