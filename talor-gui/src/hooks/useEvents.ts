/**
 * useEvents Hook - Event Handling Hook
 * 事件处理 Hook
 *
 * Provides a React hook for subscribing to and handling backend events.
 * Automatically updates relevant stores based on event types.
 *
 * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
 * @requirements 8.3 - MCP 服务器连接状态变化时实时更新显示
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ConnectionState, EventsApi } from '../api/events';
import type {
    Event,
    MCPServerEventData,
    MessageEventData,
    PermissionRequestEventData,
    SessionEventData,
    StreamDoneEventData,
    StreamErrorEventData,
    StreamTextEventData,
    StreamToolCallEventData,
    StreamToolResultEventData,
    TaskArtifactAddedEventData,
    TaskCompletedEventData,
    TaskCreatedEventData,
    TaskFailedEventData,
    TaskProgressEventData,
    TaskStatusChangedEventData,
} from '../types/event';
import type { TaskArtifact, TaskStatus } from '../api/task';
import type { Message } from '../types/message';
import type { PermissionRequest } from '../types/permission';
import type { SessionInfo } from '../types/session';

/**
 * Event handler callbacks interface
 * 事件处理回调接口
 */
export interface EventHandlers {
  /** Handler for session created events / 会话创建事件处理 */
  onSessionCreated?: (data: SessionEventData) => void;
  /** Handler for session updated events / 会话更新事件处理 */
  onSessionUpdated?: (data: SessionEventData) => void;
  /** Handler for session deleted events / 会话删除事件处理 */
  onSessionDeleted?: (data: SessionEventData) => void;
  /** Handler for message created events / 消息创建事件处理 */
  onMessageCreated?: (data: MessageEventData) => void;
  /** Handler for message updated events / 消息更新事件处理 */
  onMessageUpdated?: (data: MessageEventData) => void;
  /** Handler for permission requested events / 权限请求事件处理 */
  onPermissionRequested?: (data: PermissionRequestEventData) => void;
  /** Handler for MCP server connected events / MCP 服务器连接事件处理 */
  onMCPServerConnected?: (data: MCPServerEventData) => void;
  /** Handler for MCP server disconnected events / MCP 服务器断开事件处理 */
  onMCPServerDisconnected?: (data: MCPServerEventData) => void;
  /** Handler for connection state changes / 连接状态变化处理 */
  onConnectionStateChange?: (state: ConnectionState, retryCount?: number) => void;
  // Streaming event handlers (方案 B)
  /** Handler for stream text events / 流式文本事件处理 */
  onStreamText?: (data: StreamTextEventData) => void;
  /** Handler for stream tool call events / 流式工具调用事件处理 */
  onStreamToolCall?: (data: StreamToolCallEventData) => void;
  /** Handler for stream tool result events / 流式工具结果事件处理 */
  onStreamToolResult?: (data: StreamToolResultEventData) => void;
  /** Handler for stream done events / 流式完成事件处理 */
  onStreamDone?: (data: StreamDoneEventData) => void;
  /** Handler for stream error events / 流式错误事件处理 */
  onStreamError?: (data: StreamErrorEventData) => void;
}

/**
 * Store update callbacks interface
 * Store 更新回调接口
 */
export interface StoreCallbacks {
  /** Add a session to the session list / 添加会话到会话列表 */
  addSession?: (session: SessionInfo) => void;
  /** Update a session in the session list / 更新会话列表中的会话 */
  updateSession?: (sessionId: string, updates: Partial<SessionInfo>) => void;
  /** Remove a session from the session list / 从会话列表中移除会话 */
  removeSession?: (sessionId: string) => void;
  /** Add a message to a session / 向会话添加消息 */
  addMessage?: (message: Message) => void;
  /** Update a message / 更新消息 */
  updateMessage?: (messageId: string, updates: Partial<Message>) => void;
  /** Show permission dialog / 显示权限对话框 */
  showPermissionDialog?: (request: PermissionRequest) => void;
  /** Update MCP server status / 更新 MCP 服务器状态 */
  updateMCPServerStatus?: (serverId: string, connected: boolean, error?: string) => void;
  /** Set connection state / 设置连接状态 */
  setConnectionState?: (state: ConnectionState, retryCount?: number) => void;
  // Streaming callbacks (方案 B)
  /** Append streaming text to a message / 向消息追加流式文本 */
  appendStreamingText?: (sessionId: string, messageId: string, content: string) => void;
  /** Add tool call to a message / 向消息添加工具调用 */
  addToolCall?: (sessionId: string, messageId: string, toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => void;
  /** Add tool result to a message / 向消息添加工具结果 */
  addToolResult?: (sessionId: string, messageId: string, toolResult: { toolCallId: string; output: string; error?: string }) => void;
  /** Set loading state / 设置加载状态 */
  setLoading?: (loading: boolean) => void;
  /** Set error state / 设置错误状态 */
  setError?: (error: string | null) => void;
  // Task callbacks (background task system)
  /** Upsert a task (from task.created event) */
  upsertTask?: (task: { id: string; sessionId: string; agentId: string; title: string; status: TaskStatus }) => void;
  /** Update task status */
  updateTaskStatus?: (taskId: string, status: TaskStatus) => void;
  /** Update task progress */
  updateTaskProgress?: (taskId: string, progress: number, currentAction: string | null) => void;
  /** Add artifact to task */
  addTaskArtifact?: (taskId: string, artifact: TaskArtifact) => void;
  /** Mark task as completed */
  completeTask?: (taskId: string, result: string | null, artifactsCount: number) => void;
  /** Mark task as failed */
  failTask?: (taskId: string, error: string) => void;
}

/**
 * useEvents hook options
 * useEvents Hook 选项
 */
export interface UseEventsOptions {
  /** Events API instance / 事件 API 实例 */
  eventsApi: EventsApi | null;
  /** Custom event handlers / 自定义事件处理 */
  handlers?: EventHandlers;
  /** Store update callbacks / Store 更新回调 */
  storeCallbacks?: StoreCallbacks;
  /** Whether to auto-connect on mount / 是否在挂载时自动连接 */
  autoConnect?: boolean;
}

/**
 * useEvents hook return type
 * useEvents Hook 返回类型
 */
export interface UseEventsReturn {
  /** Current connection state / 当前连接状态 */
  connectionState: ConnectionState;
  /** Current retry count / 当前重试次数 */
  retryCount: number;
  /** Manually trigger reconnection / 手动触发重连 */
  reconnect: () => void;
  /** Disconnect from event stream / 断开事件流连接 */
  disconnect: () => void;
}

/**
 * Validates and extracts session event data
 * 验证并提取会话事件数据
 *
 * @param data - Raw event data / 原始事件数据
 * @returns Validated session event data or null / 验证后的会话事件数据或 null
 */
export function extractSessionEventData(data: Record<string, unknown>): SessionEventData | null {
  // Support both nested info object (from backend) and flat structure
  const info = data.info as Record<string, unknown> | undefined;
  const sessionId = (info?.id ?? data.session_id ?? data.sessionId) as string | undefined;
  const title = (info?.title ?? data.title) as string | undefined;

  if (typeof sessionId !== 'string') {
    return null;
  }

  return {
    sessionId,
    title,
  };
}

/**
 * Validates and extracts message event data
 * 验证并提取消息事件数据
 *
 * @param data - Raw event data / 原始事件数据
 * @returns Validated message event data or null / 验证后的消息事件数据或 null
 */
export function extractMessageEventData(data: Record<string, unknown>): MessageEventData | null {
  // Support both snake_case (from backend) and camelCase
  const messageId = (data.message_id ?? data.messageId) as string | undefined;
  const sessionId = (data.session_id ?? data.sessionId) as string | undefined;

  if (typeof messageId !== 'string' || typeof sessionId !== 'string') {
    return null;
  }

  return {
    messageId,
    sessionId,
    role: typeof data.role === 'string' ? data.role : undefined,
    parts: Array.isArray(data.parts) ? data.parts as MessageEventData['parts'] : undefined,
  };
}

/**
 * Validates and extracts permission request event data
 * 验证并提取权限请求事件数据
 *
 * @param data - Raw event data / 原始事件数据
 * @returns Validated permission request event data or null / 验证后的权限请求事件数据或 null
 */
export function extractPermissionRequestEventData(
  data: Record<string, unknown>
): PermissionRequestEventData | null {
  if (
    typeof data.requestId !== 'string' ||
    typeof data.sessionId !== 'string' ||
    typeof data.toolName !== 'string'
  ) {
    return null;
  }

  return {
    requestId: data.requestId,
    sessionId: data.sessionId,
    toolName: data.toolName,
    arguments:
      typeof data.arguments === 'object' && data.arguments !== null
        ? (data.arguments as Record<string, unknown>)
        : {},
    description: typeof data.description === 'string' ? data.description : '',
  };
}

/**
 * Validates and extracts MCP server event data
 * 验证并提取 MCP 服务器事件数据
 *
 * @param data - Raw event data / 原始事件数据
 * @returns Validated MCP server event data or null / 验证后的 MCP 服务器事件数据或 null
 */
export function extractMCPServerEventData(data: Record<string, unknown>): MCPServerEventData | null {
  // Accept either serverId or serverName as the identifier
  const serverName = typeof data.serverName === 'string' ? data.serverName :
                     typeof data.serverId === 'string' ? data.serverId : null;

  if (!serverName) {
    return null;
  }

  return {
    serverName,
    status: typeof data.status === 'string' ? data.status : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

// =============================================================================
// Streaming Event Extractors (方案 B)
// =============================================================================

/**
 * Validates and extracts stream text event data
 * 验证并提取流式文本事件数据
 */
export function extractStreamTextEventData(data: Record<string, unknown>): StreamTextEventData | null {
  if (
    typeof data.session_id !== 'string' ||
    typeof data.message_id !== 'string' ||
    typeof data.content !== 'string'
  ) {
    return null;
  }

  return {
    session_id: data.session_id,
    message_id: data.message_id,
    content: data.content,
  };
}

/**
 * Validates and extracts stream tool call event data
 * 验证并提取流式工具调用事件数据
 */
export function extractStreamToolCallEventData(data: Record<string, unknown>): StreamToolCallEventData | null {
  if (
    typeof data.session_id !== 'string' ||
    typeof data.message_id !== 'string' ||
    typeof data.call_id !== 'string' ||
    typeof data.tool !== 'string'
  ) {
    return null;
  }

  return {
    session_id: data.session_id,
    message_id: data.message_id,
    call_id: data.call_id,
    tool: data.tool,
    input: typeof data.input === 'object' && data.input !== null
      ? (data.input as Record<string, unknown>)
      : {},
  };
}

/**
 * Validates and extracts stream tool result event data
 * 验证并提取流式工具结果事件数据
 */
export function extractStreamToolResultEventData(data: Record<string, unknown>): StreamToolResultEventData | null {
  if (
    typeof data.session_id !== 'string' ||
    typeof data.message_id !== 'string' ||
    typeof data.call_id !== 'string' ||
    typeof data.tool !== 'string'
  ) {
    return null;
  }

  return {
    session_id: data.session_id,
    message_id: data.message_id,
    call_id: data.call_id,
    tool: data.tool,
    output: typeof data.output === 'string' ? data.output : '',
    title: typeof data.title === 'string' ? data.title : undefined,
    metadata: typeof data.metadata === 'object' && data.metadata !== null
      ? (data.metadata as Record<string, unknown>)
      : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

/**
 * Validates and extracts stream done event data
 * 验证并提取流式完成事件数据
 */
export function extractStreamDoneEventData(data: Record<string, unknown>): StreamDoneEventData | null {
  if (
    typeof data.session_id !== 'string' ||
    typeof data.message_id !== 'string' ||
    typeof data.reason !== 'string'
  ) {
    return null;
  }

  return {
    session_id: data.session_id,
    message_id: data.message_id,
    reason: data.reason,
  };
}

/**
 * Validates and extracts stream error event data
 * 验证并提取流式错误事件数据
 */
export function extractStreamErrorEventData(data: Record<string, unknown>): StreamErrorEventData | null {
  if (
    typeof data.session_id !== 'string' ||
    typeof data.error !== 'string'
  ) {
    return null;
  }

  return {
    session_id: data.session_id,
    message_id: typeof data.message_id === 'string' ? data.message_id : undefined,
    error: data.error,
  };
}

// =============================================================================
// Task Event Extractors
// =============================================================================

export function extractTaskCreatedEventData(data: Record<string, unknown>): TaskCreatedEventData | null {
  if (typeof data.task_id !== 'string' || typeof data.session_id !== 'string') return null;
  return {
    task_id: data.task_id,
    session_id: data.session_id,
    agent_id: typeof data.agent_id === 'string' ? data.agent_id : '',
    title: typeof data.title === 'string' ? data.title : '',
  };
}

export function extractTaskStatusChangedEventData(data: Record<string, unknown>): TaskStatusChangedEventData | null {
  if (typeof data.task_id !== 'string' || typeof data.status !== 'string') return null;
  return {
    task_id: data.task_id,
    session_id: typeof data.session_id === 'string' ? data.session_id : '',
    status: data.status,
    previous_status: typeof data.previous_status === 'string' ? data.previous_status : '',
  };
}

export function extractTaskProgressEventData(data: Record<string, unknown>): TaskProgressEventData | null {
  if (typeof data.task_id !== 'string' || typeof data.progress !== 'number') return null;
  return {
    task_id: data.task_id,
    session_id: typeof data.session_id === 'string' ? data.session_id : '',
    progress: data.progress,
    current_action: typeof data.current_action === 'string' ? data.current_action : null,
  };
}

export function extractTaskArtifactAddedEventData(data: Record<string, unknown>): TaskArtifactAddedEventData | null {
  if (typeof data.task_id !== 'string' || typeof data.path !== 'string') return null;
  return {
    task_id: data.task_id,
    session_id: typeof data.session_id === 'string' ? data.session_id : '',
    path: data.path,
    artifact_type: typeof data.artifact_type === 'string' ? data.artifact_type : 'file',
  };
}

export function extractTaskCompletedEventData(data: Record<string, unknown>): TaskCompletedEventData | null {
  if (typeof data.task_id !== 'string') return null;
  return {
    task_id: data.task_id,
    session_id: typeof data.session_id === 'string' ? data.session_id : '',
    result: typeof data.result === 'string' ? data.result : null,
    artifacts_count: typeof data.artifacts_count === 'number' ? data.artifacts_count : 0,
    elapsed_ms: typeof data.elapsed_ms === 'number' ? data.elapsed_ms : 0,
  };
}

export function extractTaskFailedEventData(data: Record<string, unknown>): TaskFailedEventData | null {
  if (typeof data.task_id !== 'string' || typeof data.error !== 'string') return null;
  return {
    task_id: data.task_id,
    session_id: typeof data.session_id === 'string' ? data.session_id : '',
    error: data.error,
  };
}

/**
 * Creates an event handler that processes events and updates stores
 * 创建处理事件并更新 stores 的事件处理函数
 *
 * @param handlers - Custom event handlers / 自定义事件处理
 * @param storeCallbacks - Store update callbacks / Store 更新回调
 * @returns Event handler function / 事件处理函数
 */
export function createEventHandler(
  handlers: EventHandlers,
  storeCallbacks: StoreCallbacks
): (event: Event) => void {
  return (event: Event) => {
    const { type, data, timestamp } = event;

    // Debug log for streaming events
    if (type.startsWith('stream.')) {
      console.debug('[EventHandler] Processing streaming event:', type, data);
    }

    switch (type) {
      case 'session.created': {
        const sessionData = extractSessionEventData(data);
        if (sessionData) {
          // Call custom handler
          handlers.onSessionCreated?.(sessionData);

          // Update store
          if (storeCallbacks.addSession) {
            const newSession: SessionInfo = {
              id: sessionData.sessionId,
              title: sessionData.title ?? 'New Session',
              createdAt: timestamp,
              updatedAt: timestamp,
              messageCount: 0,
            };
            storeCallbacks.addSession(newSession);
          }
        }
        break;
      }

      case 'session.updated': {
        const sessionData = extractSessionEventData(data);
        if (sessionData) {
          // Call custom handler
          handlers.onSessionUpdated?.(sessionData);

          // Update store
          if (storeCallbacks.updateSession) {
            const updates: Partial<SessionInfo> = {
              updatedAt: timestamp,
            };
            if (sessionData.title) {
              updates.title = sessionData.title;
            }
            storeCallbacks.updateSession(sessionData.sessionId, updates);
          }
        }
        break;
      }

      case 'session.deleted': {
        const sessionData = extractSessionEventData(data);
        if (sessionData) {
          console.debug('[EventHandler] Session deleted event:', sessionData.sessionId);
          // Call custom handler
          handlers.onSessionDeleted?.(sessionData);

          // Update store
          storeCallbacks.removeSession?.(sessionData.sessionId);
        }
        break;
      }

      case 'message.created': {
        const messageData = extractMessageEventData(data);
        if (messageData) {
          // Call custom handler
          handlers.onMessageCreated?.(messageData);

          // Update store
          if (storeCallbacks.addMessage) {
            const role = messageData.role ?? (data.role as string) ?? 'assistant';

            // Extract content from parts if available
            let content = '';
            if (messageData.parts) {
              content = messageData.parts
                .filter((p) => p.type === 'text' && p.text)
                .map((p) => p.text)
                .join('');
            } else if (typeof data.content === 'string') {
              content = data.content;
            }

            const newMessage: Message = {
              id: messageData.messageId,
              sessionId: messageData.sessionId,
              role: role as Message['role'],
              content,
              createdAt: timestamp,
            };
            storeCallbacks.addMessage(newMessage);
          }
        }
        break;
      }

      case 'message.updated': {
        const messageData = extractMessageEventData(data);
        if (messageData) {
          // Call custom handler
          handlers.onMessageUpdated?.(messageData);

          // Update store
          if (storeCallbacks.updateMessage) {
            // Extract content from parts if available
            let content: string | undefined;
            if (messageData.parts) {
              content = messageData.parts
                .filter((p) => p.type === 'text' && p.text)
                .map((p) => p.text)
                .join('');
            } else if (typeof data.content === 'string') {
              content = data.content;
            }

            if (content !== undefined) {
              storeCallbacks.updateMessage(messageData.messageId, { content });
            }
          }
        }
        break;
      }

      case 'permission.requested': {
        const permissionData = extractPermissionRequestEventData(data);
        if (permissionData) {
          // Call custom handler
          handlers.onPermissionRequested?.(permissionData);

          // Update store - show permission dialog
          if (storeCallbacks.showPermissionDialog) {
            const request: PermissionRequest = {
              id: permissionData.requestId,
              sessionId: permissionData.sessionId,
              toolName: permissionData.toolName,
              arguments: permissionData.arguments,
              description: permissionData.description,
            };
            storeCallbacks.showPermissionDialog(request);
          }
        }
        break;
      }

      case 'mcp.server_connected': {
        const mcpData = extractMCPServerEventData(data);
        if (mcpData) {
          // Call custom handler
          handlers.onMCPServerConnected?.(mcpData);

          // Update store
          storeCallbacks.updateMCPServerStatus?.(mcpData.serverName, true);
        }
        break;
      }

      case 'mcp.server_disconnected': {
        const mcpData = extractMCPServerEventData(data);
        if (mcpData) {
          // Call custom handler
          handlers.onMCPServerDisconnected?.(mcpData);

          // Update store
          storeCallbacks.updateMCPServerStatus?.(mcpData.serverName, false, mcpData.error);
        }
        break;
      }

      // =================================================================
      // Streaming Events (方案 B - 分离式架构)
      // =================================================================

      case 'stream.text': {
        const streamData = extractStreamTextEventData(data);
        if (streamData) {
          // Call custom handler
          handlers.onStreamText?.(streamData);

          // Update store - append text to message
          storeCallbacks.appendStreamingText?.(
            streamData.session_id,
            streamData.message_id,
            streamData.content
          );
        }
        break;
      }

      case 'stream.tool_call': {
        const streamData = extractStreamToolCallEventData(data);
        if (streamData) {
          // Call custom handler
          handlers.onStreamToolCall?.(streamData);

          // Update store - add tool call to message
          storeCallbacks.addToolCall?.(
            streamData.session_id,
            streamData.message_id,
            {
              id: streamData.call_id,
              name: streamData.tool,
              arguments: streamData.input,
            }
          );
        }
        break;
      }

      case 'stream.tool_result': {
        const streamData = extractStreamToolResultEventData(data);
        if (streamData) {
          // Call custom handler
          handlers.onStreamToolResult?.(streamData);

          // Update store - add tool result to message
          storeCallbacks.addToolResult?.(
            streamData.session_id,
            streamData.message_id,
            {
              toolCallId: streamData.call_id,
              output: streamData.output,
              error: streamData.error,
            }
          );
        }
        break;
      }

      case 'stream.done': {
        const streamData = extractStreamDoneEventData(data);
        if (streamData) {
          // Call custom handler
          handlers.onStreamDone?.(streamData);

          // Update store - set loading to false
          storeCallbacks.setLoading?.(false);
        }
        break;
      }

      case 'stream.error': {
        const streamData = extractStreamErrorEventData(data);
        if (streamData) {
          // Call custom handler
          handlers.onStreamError?.(streamData);

          // Update store - set error and loading to false
          storeCallbacks.setError?.(streamData.error);
          storeCallbacks.setLoading?.(false);
        }
        break;
      }

      // =================================================================
      // Task Events (Background Task System)
      // =================================================================

      case 'task.created': {
        const taskData = extractTaskCreatedEventData(data);
        if (taskData) {
          storeCallbacks.upsertTask?.({
            id: taskData.task_id,
            sessionId: taskData.session_id,
            agentId: taskData.agent_id,
            title: taskData.title,
            status: 'pending',
          });
        }
        break;
      }

      case 'task.status_changed': {
        const taskData = extractTaskStatusChangedEventData(data);
        if (taskData) {
          storeCallbacks.updateTaskStatus?.(taskData.task_id, taskData.status as TaskStatus);
        }
        break;
      }

      case 'task.progress': {
        const taskData = extractTaskProgressEventData(data);
        if (taskData) {
          storeCallbacks.updateTaskProgress?.(taskData.task_id, taskData.progress, taskData.current_action);
        }
        break;
      }

      case 'task.artifact_added': {
        const taskData = extractTaskArtifactAddedEventData(data);
        if (taskData) {
          storeCallbacks.addTaskArtifact?.(taskData.task_id, {
            path: taskData.path,
            type: taskData.artifact_type,
            updatedAt: timestamp,
          });
        }
        break;
      }

      case 'task.completed': {
        const taskData = extractTaskCompletedEventData(data);
        if (taskData) {
          storeCallbacks.completeTask?.(taskData.task_id, taskData.result, taskData.artifacts_count);
        }
        break;
      }

      case 'task.failed': {
        const taskData = extractTaskFailedEventData(data);
        if (taskData) {
          storeCallbacks.failTask?.(taskData.task_id, taskData.error);
        }
        break;
      }

      // agent.response and agent.tool_call are typically handled by the streaming
      // response in the agent API, so we don't need to handle them here
      default:
        // Unknown event type - ignore
        break;
    }
  };
}

/**
 * useEvents Hook
 * 事件处理 Hook
 *
 * Subscribes to backend events and handles them appropriately,
 * updating stores and calling custom handlers.
 *
 * @param options - Hook options / Hook 选项
 * @returns Hook return value / Hook 返回值
 */
export function useEvents(options: UseEventsOptions): UseEventsReturn {
  const { eventsApi, handlers = {}, storeCallbacks = {}, autoConnect = true } = options;

  // Use refs to store the latest handlers and callbacks to avoid re-subscribing
  const handlersRef = useRef(handlers);
  const storeCallbacksRef = useRef(storeCallbacks);
  const connectionStateRef = useRef<ConnectionState>('disconnected');
  const retryCountRef = useRef(0);

  // Update refs when props change
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    storeCallbacksRef.current = storeCallbacks;
  }, [storeCallbacks]);

  // Subscribe to events
  useEffect(() => {
    if (!eventsApi || !autoConnect) {
      return;
    }

    // Create event handler that uses refs
    const eventHandler = (event: Event) => {
      const handler = createEventHandler(handlersRef.current, storeCallbacksRef.current);
      handler(event);
    };

    // Subscribe to events
    const unsubscribe = eventsApi.subscribe(eventHandler);

    // Set up connection state handler
    eventsApi.onConnectionStateChange((state, retryCount) => {
      connectionStateRef.current = state;
      retryCountRef.current = retryCount ?? 0;

      // Call custom handler
      handlersRef.current.onConnectionStateChange?.(state, retryCount);

      // Update store
      storeCallbacksRef.current.setConnectionState?.(state, retryCount);
    });

    // Cleanup on unmount
    return () => {
      unsubscribe();
      eventsApi.disconnect();
    };
  }, [eventsApi, autoConnect]);

  // Reconnect function
  const reconnect = useCallback(() => {
    eventsApi?.reconnect();
  }, [eventsApi]);

  // Disconnect function
  const disconnect = useCallback(() => {
    eventsApi?.disconnect();
  }, [eventsApi]);

  return {
    connectionState: eventsApi?.getConnectionState() ?? 'disconnected',
    retryCount: eventsApi?.getRetryCount() ?? 0,
    reconnect,
    disconnect,
  };
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default useEvents;
