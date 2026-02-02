/**
 * App Component - Application Entry Point
 * 应用入口组件
 *
 * Main application component that integrates all providers and routing.
 * This is the root component that sets up:
 * - ThemeProvider for theme management
 * - I18nextProvider for internationalization
 * - React Router for navigation
 * - API client initialization
 * - Event subscription and handling
 *
 * @requirements 1.1 - HTTP 连接到 Talor_Backend 的 REST API
 * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
 */

import React, { useEffect, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './components/common/ThemeProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AppRouter } from './router';
import i18n from './i18n';
import { TalorClient } from './api/client';
import { createSessionApi } from './api/session';
import { createAgentApi } from './api/agent';
import { createConfigApi } from './api/config';
import { createEventsApi, type ConnectionState } from './api/events';
import { useSessionStore } from './store/session';
import { useUIStore } from './store/ui';
import { useEvents, type StoreCallbacks, type EventHandlers } from './hooks/useEvents';
import type { SessionInfo } from './types/session';
import type { Message } from './types/message';
import type { PermissionRequest } from './types/permission';

/**
 * Default API base URL
 * 默认 API 基础 URL
 * 
 * In development, we use an empty string because Vite proxy handles the routing.
 * In production, this should be set via VITE_API_BASE_URL environment variable.
 */
const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * App component props interface
 * App 组件属性接口
 */
export interface AppProps {
  /** Custom API base URL (optional, for testing) / 自定义 API 基础 URL（可选，用于测试） */
  apiBaseUrl?: string;
}

/**
 * App component
 * 应用入口组件
 *
 * The main application component that:
 * 1. Initializes the API client
 * 2. Sets up all context providers (Theme, i18n)
 * 3. Integrates the router
 * 4. Handles event subscriptions and updates stores
 *
 * @param props - App component props / App 组件属性
 * @returns App component / App 组件
 *
 * @requirements 1.1 - HTTP 连接到 Talor_Backend 的 REST API
 * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
 */
export const App: React.FC<AppProps> = ({ apiBaseUrl = DEFAULT_API_BASE_URL }) => {
  // Get store actions for session management
  const setApis = useSessionStore((state) => state.setApis);
  const addSession = useSessionStore((state) => state.addSession);
  const updateSession = useSessionStore((state) => state.updateSession);
  const removeSession = useSessionStore((state) => state.removeSession);
  const addMessage = useSessionStore((state) => state.addMessage);
  const updateMessage = useSessionStore((state) => state.updateMessage);
  // Streaming callbacks (方案 B)
  const appendStreamingText = useSessionStore((state) => state.appendStreamingText);
  const addToolCall = useSessionStore((state) => state.addToolCall);
  const addToolResult = useSessionStore((state) => state.addToolResult);
  const setLoading = useSessionStore((state) => state.setLoading);
  const setError = useSessionStore((state) => state.setError);

  // Get store actions for UI management
  const setConnectionState = useUIStore((state) => state.setConnectionState);
  const showPermissionDialog = useUIStore((state) => state.showPermissionDialog);

  /**
   * Initialize API client and related APIs
   * 初始化 API 客户端和相关 API
   */
  const { sessionApi, agentApi, eventsApi } = useMemo(() => {
    // Create the main API client
    const talorClient = new TalorClient({
      baseUrl: apiBaseUrl,
      timeout: 30000,
      onError: (error) => {
        console.error('API Error:', error);
      },
    });

    // Create API modules
    const session = createSessionApi(talorClient);
    const agent = createAgentApi(talorClient);
    // Config API will be used in settings components
    createConfigApi(talorClient);
    const events = createEventsApi(talorClient);

    return {
      sessionApi: session,
      agentApi: agent,
      eventsApi: events,
    };
  }, [apiBaseUrl]);

  /**
   * Store callbacks for event handling
   * 事件处理的 Store 回调
   *
   * These callbacks are used by the useEvents hook to update stores
   * when events are received from the backend.
   */
  const storeCallbacks: StoreCallbacks = useMemo(
    () => ({
      /**
       * Add a session to the session list
       * 添加会话到会话列表
       */
      addSession: (session: SessionInfo) => {
        addSession(session);
      },

      /**
       * Update a session in the session list
       * 更新会话列表中的会话
       */
      updateSession: (sessionId: string, updates: Partial<SessionInfo>) => {
        updateSession(sessionId, updates);
      },

      /**
       * Remove a session from the session list
       * 从会话列表中移除会话
       */
      removeSession: (sessionId: string) => {
        removeSession(sessionId);
      },

      /**
       * Add a message to a session
       * 向会话添加消息
       */
      addMessage: (message: Message) => {
        addMessage(message);
      },

      /**
       * Update a message
       * 更新消息
       */
      updateMessage: (messageId: string, updates: Partial<Message>) => {
        updateMessage(messageId, updates);
      },

      /**
       * Show permission dialog
       * 显示权限对话框
       */
      showPermissionDialog: (request: PermissionRequest) => {
        showPermissionDialog(request);
      },

      /**
       * Update MCP server status
       * 更新 MCP 服务器状态
       *
       * Note: MCP server status is typically managed by the settings store
       * or a dedicated MCP store. For now, we log the status change.
       */
      updateMCPServerStatus: (serverId: string, connected: boolean, error?: string) => {
        console.debug('MCP server status changed:', { serverId, connected, error });
        // TODO: Implement MCP server status tracking in a dedicated store
      },

      /**
       * Set connection state
       * 设置连接状态
       */
      setConnectionState: (state: ConnectionState, retryCount?: number) => {
        setConnectionState(state, retryCount);
      },

      // =================================================================
      // Streaming callbacks (方案 B - 分离式架构)
      // =================================================================

      /**
       * Append streaming text to a message
       * 向消息追加流式文本
       */
      appendStreamingText: (sessionId: string, messageId: string, content: string) => {
        appendStreamingText(sessionId, messageId, content);
      },

      /**
       * Add tool call to a message
       * 向消息添加工具调用
       */
      addToolCall: (sessionId: string, messageId: string, toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => {
        addToolCall(sessionId, messageId, toolCall);
      },

      /**
       * Add tool result to a message
       * 向消息添加工具结果
       */
      addToolResult: (sessionId: string, messageId: string, toolResult: { toolCallId: string; output: string; error?: string }) => {
        addToolResult(sessionId, messageId, toolResult);
      },

      /**
       * Set loading state
       * 设置加载状态
       */
      setLoading: (loading: boolean) => {
        setLoading(loading);
      },

      /**
       * Set error state
       * 设置错误状态
       */
      setError: (error: string | null) => {
        setError(error);
      },
    }),
    [addSession, updateSession, removeSession, addMessage, updateMessage, showPermissionDialog, setConnectionState, appendStreamingText, addToolCall, addToolResult, setLoading, setError]
  );

  /**
   * Custom event handlers for additional processing
   * 自定义事件处理器用于额外处理
   */
  const eventHandlers: EventHandlers = useMemo(
    () => ({
      /**
       * Handle connection state changes
       * 处理连接状态变化
       */
      onConnectionStateChange: (state: ConnectionState, retryCount?: number) => {
        console.debug('Connection state changed:', state, 'retry count:', retryCount);
      },

      /**
       * Handle MCP server connected events
       * 处理 MCP 服务器连接事件
       */
      onMCPServerConnected: (data) => {
        console.debug('MCP server connected:', data.serverName);
      },

      /**
       * Handle MCP server disconnected events
       * 处理 MCP 服务器断开事件
       */
      onMCPServerDisconnected: (data) => {
        console.debug('MCP server disconnected:', data.serverName, data.error);
      },

      // =================================================================
      // Streaming event handlers (方案 B - 分离式架构)
      // =================================================================

      /**
       * Handle stream text events
       * 处理流式文本事件
       */
      onStreamText: (data) => {
        console.debug('Stream text:', data.message_id, data.content.length, 'chars');
      },

      /**
       * Handle stream tool call events
       * 处理流式工具调用事件
       */
      onStreamToolCall: (data) => {
        console.debug('Stream tool call:', data.tool, data.call_id);
      },

      /**
       * Handle stream tool result events
       * 处理流式工具结果事件
       */
      onStreamToolResult: (data) => {
        console.debug('Stream tool result:', data.tool, data.call_id, data.error ? 'error' : 'success');
      },

      /**
       * Handle stream done events
       * 处理流式完成事件
       */
      onStreamDone: (data) => {
        console.debug('Stream done:', data.message_id, 'reason:', data.reason);
      },

      /**
       * Handle stream error events
       * 处理流式错误事件
       */
      onStreamError: (data) => {
        console.error('Stream error:', data.error);
      },
    }),
    []
  );

  /**
   * Initialize the useEvents hook for event subscription
   * 初始化 useEvents hook 用于事件订阅
   *
   * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
   */
  useEvents({
    eventsApi,
    handlers: eventHandlers,
    storeCallbacks,
    autoConnect: true,
  });

  /**
   * Initialize APIs in session store
   * 在会话 store 中初始化 API
   */
  useEffect(() => {
    setApis(sessionApi, agentApi, eventsApi);
  }, [sessionApi, agentApi, eventsApi, setApis]);

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ErrorBoundary
          onError={(error, errorInfo) => {
            // Log error to console for debugging
            console.error('Application error caught by ErrorBoundary:', error);
            console.error('Component stack:', errorInfo.componentStack);
          }}
        >
          <AppRouter />
        </ErrorBoundary>
      </ThemeProvider>
    </I18nextProvider>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default App;
