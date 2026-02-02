/**
 * Event types for Talor GUI
 * 事件相关类型定义
 *
 * @requirements 1.2 - 后端通信（实时事件）
 */

/**
 * Event type enumeration
 * 事件类型枚举
 *
 * Maps to Bus event types from the backend.
 */
export type EventType =
  // Session events
  | 'session.created'
  | 'session.updated'
  | 'session.deleted'
  // Message events
  | 'message.created'
  | 'message.updated'
  // Agent events
  | 'agent.response'
  | 'agent.tool_call'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.error'
  // Permission events
  | 'permission.requested'
  // MCP events
  | 'mcp.server_connected'
  | 'mcp.server_disconnected'
  // Streaming events (方案 B - 分离式架构)
  | 'stream.text'
  | 'stream.tool_call'
  | 'stream.tool_result'
  | 'stream.done'
  | 'stream.error';

/**
 * Base event structure from the backend
 * 后端返回的基础事件结构
 *
 * This matches the Bus event format from the backend.
 */
export interface Event {
  /** Event type / 事件类型 */
  type: EventType;
  /** Event payload data (from Bus event properties) / 事件负载数据 */
  data: Record<string, unknown>;
  /** Event timestamp (Unix milliseconds) / 事件时间戳（Unix毫秒） */
  timestamp: number;
}

/**
 * Session event data
 * 会话事件数据
 */
export interface SessionEventData {
  /** Session ID / 会话ID */
  sessionId: string;
  /** Session title (for created/updated events) / 会话标题 */
  title?: string;
  /** Session directory / 会话目录 */
  directory?: string;
  /** Parent session ID / 父会话ID */
  parentId?: string;
}

/**
 * Message event data
 * 消息事件数据
 */
export interface MessageEventData {
  /** Message ID / 消息ID */
  messageId: string;
  /** Session ID / 会话ID */
  sessionId: string;
  /** Message role / 消息角色 */
  role?: string;
  /** Message parts / 消息部分 */
  parts?: Array<{
    type: string;
    text?: string;
    tool_call_id?: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    tool_result?: string;
    tool_error?: string;
  }>;
}

/**
 * Agent response event data
 * 代理响应事件数据
 */
export interface AgentResponseEventData {
  /** Session ID / 会话ID */
  sessionId: string;
  /** Agent name / 代理名称 */
  agent?: string;
  /** Response type / 响应类型 */
  responseType?: string;
  /** Response content / 响应内容 */
  content?: string | Record<string, unknown>;
  /** Error message (for error events) / 错误信息 */
  error?: string;
}

/**
 * Tool event data
 * 工具事件数据
 */
export interface ToolEventData {
  /** Session ID / 会话ID */
  sessionId: string;
  /** Message ID / 消息ID */
  messageId: string;
  /** Tool name / 工具名称 */
  toolName: string;
  /** Tool call ID / 工具调用ID */
  toolCallId: string;
  /** Tool arguments / 工具参数 */
  arguments?: Record<string, unknown>;
  /** Tool result (for executed events) / 工具结果 */
  result?: {
    title?: string;
    output?: string;
    metadata?: Record<string, unknown>;
  };
  /** Error message (for failed executions) / 错误信息 */
  error?: string;
}

/**
 * Permission request event data
 * 权限请求事件数据
 */
export interface PermissionRequestEventData {
  /** Request ID / 请求ID */
  requestId: string;
  /** Session ID / 会话ID */
  sessionId: string;
  /** Tool name / 工具名称 */
  toolName: string;
  /** Tool arguments / 工具参数 */
  arguments: Record<string, unknown>;
  /** Description / 描述 */
  description: string;
}

/**
 * MCP server event data
 * MCP服务器事件数据
 */
export interface MCPServerEventData {
  /** Server name / 服务器名称 */
  serverName: string;
  /** Server status / 服务器状态 */
  status?: string;
  /** Error message (for disconnect events) / 错误信息 */
  error?: string;
}

// =============================================================================
// Streaming Events (方案 B - 分离式架构)
// =============================================================================

/**
 * Stream text event data
 * 流式文本事件数据
 */
export interface StreamTextEventData {
  /** Session ID / 会话ID */
  session_id: string;
  /** Message ID / 消息ID */
  message_id: string;
  /** Incremental text content / 增量文本内容 */
  content: string;
}

/**
 * Stream tool call event data
 * 流式工具调用事件数据
 */
export interface StreamToolCallEventData {
  /** Session ID / 会话ID */
  session_id: string;
  /** Message ID / 消息ID */
  message_id: string;
  /** Tool call ID / 工具调用ID */
  call_id: string;
  /** Tool name / 工具名称 */
  tool: string;
  /** Tool input arguments / 工具输入参数 */
  input: Record<string, unknown>;
}

/**
 * Stream tool result event data
 * 流式工具结果事件数据
 */
export interface StreamToolResultEventData {
  /** Session ID / 会话ID */
  session_id: string;
  /** Message ID / 消息ID */
  message_id: string;
  /** Tool call ID / 工具调用ID */
  call_id: string;
  /** Tool name / 工具名称 */
  tool: string;
  /** Tool output / 工具输出 */
  output: string;
  /** Tool title / 工具标题 */
  title?: string;
  /** Tool metadata / 工具元数据 */
  metadata?: Record<string, unknown>;
  /** Error message / 错误信息 */
  error?: string;
}

/**
 * Stream done event data
 * 流式完成事件数据
 */
export interface StreamDoneEventData {
  /** Session ID / 会话ID */
  session_id: string;
  /** Message ID / 消息ID */
  message_id: string;
  /** Completion reason / 完成原因 */
  reason: string;
}

/**
 * Stream error event data
 * 流式错误事件数据
 */
export interface StreamErrorEventData {
  /** Session ID / 会话ID */
  session_id: string;
  /** Message ID (may be null for early errors) / 消息ID（早期错误可能为空） */
  message_id?: string;
  /** Error message / 错误信息 */
  error: string;
}

/**
 * Event handler function type
 * 事件处理函数类型
 */
export type EventHandler = (event: Event) => void;

/**
 * Unsubscribe function type
 * 取消订阅函数类型
 */
export type Unsubscribe = () => void;

/**
 * Type guard for session events
 * 会话事件类型守卫
 */
export function isSessionEvent(event: Event): event is Event & { data: SessionEventData } {
  return event.type.startsWith('session.');
}

/**
 * Type guard for message events
 * 消息事件类型守卫
 */
export function isMessageEvent(event: Event): event is Event & { data: MessageEventData } {
  return event.type.startsWith('message.');
}

/**
 * Type guard for agent events
 * 代理事件类型守卫
 */
export function isAgentEvent(event: Event): event is Event & { data: AgentResponseEventData } {
  return event.type.startsWith('agent.');
}

/**
 * Type guard for MCP events
 * MCP事件类型守卫
 */
export function isMCPEvent(event: Event): event is Event & { data: MCPServerEventData } {
  return event.type.startsWith('mcp.');
}

/**
 * Type guard for permission events
 * 权限事件类型守卫
 */
export function isPermissionEvent(event: Event): event is Event & { data: PermissionRequestEventData } {
  return event.type === 'permission.requested';
}

/**
 * Type guard for streaming events (方案 B)
 * 流式事件类型守卫（方案 B）
 */
export function isStreamEvent(event: Event): boolean {
  return event.type.startsWith('stream.');
}

/**
 * Type guard for stream text events
 * 流式文本事件类型守卫
 */
export function isStreamTextEvent(event: Event): event is Event & { data: StreamTextEventData } {
  return event.type === 'stream.text';
}

/**
 * Type guard for stream done events
 * 流式完成事件类型守卫
 */
export function isStreamDoneEvent(event: Event): event is Event & { data: StreamDoneEventData } {
  return event.type === 'stream.done';
}

/**
 * Type guard for stream error events
 * 流式错误事件类型守卫
 */
export function isStreamErrorEvent(event: Event): event is Event & { data: StreamErrorEventData } {
  return event.type === 'stream.error';
}
