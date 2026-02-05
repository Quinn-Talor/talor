/**
 * Events API Module - SSE Event Subscription
 * 事件 API 模块 - SSE 事件订阅
 *
 * Provides Server-Sent Events (SSE) connection management for real-time
 * event streaming from the Talor backend.
 * 为 Talor 后端提供服务器发送事件 (SSE) 连接管理以进行实时事件流。
 *
 * Desktop client uses a single global SSE connection.
 * 桌面客户端使用单一全局 SSE 连接。
 *
 * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
 * @requirements 1.3 - 自动尝试重新连接并显示连接状态
 */

import type { Event, EventHandler, Unsubscribe } from '../types/event';
import type { TalorClient } from './client';

/**
 * Connection error class for SSE connection failures
 * SSE 连接失败的连接错误类
 */
export class ConnectionError extends Error {
  readonly retryCount: number;

  constructor(message: string, retryCount: number) {
    super(message);
    this.name = 'ConnectionError';
    this.retryCount = retryCount;
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Connection state enumeration
 * 连接状态枚举
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * Connection state change handler type
 * 连接状态变化处理函数类型
 */
export type ConnectionStateHandler = (state: ConnectionState, retryCount?: number) => void;

/**
 * Events API configuration options
 * 事件 API 配置选项
 */
export interface EventsApiConfig {
  /** Maximum number of retry attempts before giving up / 放弃前的最大重试次数 */
  maxRetryCount?: number;
  /** Initial retry delay in milliseconds / 初始重试延迟（毫秒） */
  initialRetryDelay?: number;
  /** Maximum retry delay in milliseconds / 最大重试延迟（毫秒） */
  maxRetryDelay?: number;
  /** Retry delay multiplier for exponential backoff / 指数退避的重试延迟乘数 */
  retryDelayMultiplier?: number;
}

/**
 * Default configuration values
 * 默认配置值
 */
const DEFAULT_MAX_RETRY_COUNT = 5;
const DEFAULT_INITIAL_RETRY_DELAY = 1000; // 1 second
const DEFAULT_MAX_RETRY_DELAY = 30000; // 30 seconds
const DEFAULT_RETRY_DELAY_MULTIPLIER = 2;

/**
 * Events API interface
 * 事件 API 接口
 *
 * Defines all event subscription operations.
 */
export interface EventsApi {
  /**
   * Subscribes to events from the backend
   * 订阅后端事件
   *
   * @param handler - Event handler callback / 事件处理回调
   * @returns Unsubscribe function / 取消订阅函数
   */
  subscribe(handler: EventHandler): Unsubscribe;

  /**
   * Sets the connection state change handler
   * 设置连接状态变化处理函数
   *
   * @param handler - Connection state handler / 连接状态处理函数
   */
  onConnectionStateChange(handler: ConnectionStateHandler): void;

  /**
   * Gets the current connection state
   * 获取当前连接状态
   *
   * @returns Current connection state / 当前连接状态
   */
  getConnectionState(): ConnectionState;

  /**
   * Gets the current retry count
   * 获取当前重试次数
   *
   * @returns Current retry count / 当前重试次数
   */
  getRetryCount(): number;

  /**
   * Manually triggers a reconnection attempt
   * 手动触发重连尝试
   */
  reconnect(): void;

  /**
   * Disconnects from the event stream
   * 断开事件流连接
   */
  disconnect(): void;

  /**
   * Connects to the event stream
   * 连接到事件流
   */
  connect(): void;
}

/**
 * Backend Bus event format
 * 后端 Bus 事件格式
 */
interface BackendBusEvent {
  type: string;
  properties: Record<string, unknown>;
  timestamp: number;
}

/**
 * Maps backend Bus event types to frontend Event types
 * 将后端 Bus 事件类型映射到前端 Event 类型
 */
function mapEventType(backendType: string): Event['type'] {
  const typeMap: Record<string, Event['type']> = {
    'session.created': 'session.created',
    'session.updated': 'session.updated',
    'session.deleted': 'session.deleted',
    'message.created': 'message.created',
    'message.updated': 'message.updated',
    'agent.started': 'agent.started',
    'agent.completed': 'agent.completed',
    'agent.error': 'agent.error',
    'tool.executing': 'agent.tool_call',
    'tool.executed': 'agent.tool_call',
    'permission.requested': 'permission.requested',
    'mcp.connected': 'mcp.server_connected',
    'mcp.disconnected': 'mcp.server_disconnected',
    'stream.text': 'stream.text',
    'stream.tool_call': 'stream.tool_call',
    'stream.tool_result': 'stream.tool_result',
    'stream.done': 'stream.done',
    'stream.error': 'stream.error',
  };

  return typeMap[backendType] ?? ('agent.response' as Event['type']);
}

/**
 * Converts backend Bus event to frontend Event format
 * 将后端 Bus 事件转换为前端 Event 格式
 */
function toFrontendEvent(backendEvent: BackendBusEvent): Event {
  return {
    type: mapEventType(backendEvent.type),
    data: backendEvent.properties,
    timestamp: backendEvent.timestamp,
  };
}

/**
 * Parses SSE event data from a raw message
 * 从原始消息解析 SSE 事件数据
 *
 * @param data - Raw SSE data string / 原始 SSE 数据字符串
 * @returns Parsed Event object or null if parsing fails / 解析后的 Event 对象，解析失败返回 null
 */
export function parseSSEEvent(data: string): Event | null {
  try {
    const parsed = JSON.parse(data) as BackendBusEvent;

    // Validate required fields for new Bus event format
    if (
      typeof parsed.type !== 'string' ||
      typeof parsed.properties !== 'object' ||
      parsed.properties === null ||
      typeof parsed.timestamp !== 'number'
    ) {
      // Try legacy format
      const legacy = parsed as unknown as Event;
      if (
        typeof legacy.type === 'string' &&
        typeof legacy.data === 'object' &&
        legacy.data !== null &&
        typeof legacy.timestamp === 'number'
      ) {
        return legacy;
      }
      return null;
    }

    return toFrontendEvent(parsed);
  } catch {
    return null;
  }
}

/**
 * Calculates the retry delay using exponential backoff
 * 使用指数退避计算重试延迟
 */
export function calculateRetryDelay(
  retryCount: number,
  initialDelay: number = DEFAULT_INITIAL_RETRY_DELAY,
  maxDelay: number = DEFAULT_MAX_RETRY_DELAY,
  multiplier: number = DEFAULT_RETRY_DELAY_MULTIPLIER
): number {
  const delay = initialDelay * Math.pow(multiplier, retryCount);
  return Math.min(delay, maxDelay);
}

/**
 * Creates an events API instance bound to a TalorClient
 * 创建绑定到 TalorClient 的事件 API 实例
 *
 * @param client - The TalorClient instance / TalorClient 实例
 * @param config - Optional configuration / 可选配置
 * @returns Events API object / 事件 API 对象
 */
export function createEventsApi(client: TalorClient, config?: EventsApiConfig): EventsApi {
  // Configuration with defaults
  const maxRetryCount = config?.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT;
  const initialRetryDelay = config?.initialRetryDelay ?? DEFAULT_INITIAL_RETRY_DELAY;
  const maxRetryDelay = config?.maxRetryDelay ?? DEFAULT_MAX_RETRY_DELAY;
  const retryDelayMultiplier = config?.retryDelayMultiplier ?? DEFAULT_RETRY_DELAY_MULTIPLIER;

  // Internal state
  let abortController: AbortController | null = null;
  let connectionState: ConnectionState = 'disconnected';
  let retryCount = 0;
  let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastEventId: string | null = null;
  const handlers: Set<EventHandler> = new Set();
  let connectionStateHandler: ConnectionStateHandler | null = null;

  /**
   * Updates the connection state and notifies the handler
   */
  function setConnectionState(state: ConnectionState): void {
    connectionState = state;
    if (connectionStateHandler) {
      connectionStateHandler(state, retryCount);
    }
  }

  /**
   * Dispatches an event to all registered handlers
   */
  function dispatchEvent(event: Event): void {
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    });
  }

  /**
   * Clears any pending retry timeout
   */
  function clearRetryTimeout(): void {
    if (retryTimeoutId !== null) {
      clearTimeout(retryTimeoutId);
      retryTimeoutId = null;
    }
  }

  /**
   * Schedules a reconnection attempt
   */
  function scheduleReconnect(): void {
    if (retryCount >= maxRetryCount) {
      setConnectionState('failed');
      return;
    }

    const delay = calculateRetryDelay(
      retryCount,
      initialRetryDelay,
      maxRetryDelay,
      retryDelayMultiplier
    );

    setConnectionState('reconnecting');

    retryTimeoutId = setTimeout(() => {
      retryTimeoutId = null;
      connect();
    }, delay);
  }

  /**
   * Parses SSE lines from a chunk
   */
  function parseSSEChunk(chunk: string, buffer: string): { lines: string[]; remainingBuffer: string } {
    const combined = buffer + chunk;
    const parts = combined.split('\n');
    const remainingBuffer = parts.pop() ?? '';
    const lines = parts.filter((line) => line.trim().length > 0);
    return { lines, remainingBuffer };
  }

  /**
   * Establishes the SSE connection
   */
  async function connect(): Promise<void> {
    // Abort existing connection if any
    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    setConnectionState('connecting');

    const baseUrl = client.getBaseUrl();
    const eventUrl = `${baseUrl}/event`;

    console.debug('[SSE] Connecting to:', eventUrl);

    // Build headers
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
    };

    const authToken = client.getAuthToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    if (lastEventId) {
      headers['Last-Event-ID'] = lastEventId;
    }

    abortController = new AbortController();

    try {
      const response = await fetch(eventUrl, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Connection established
      retryCount = 0;
      setConnectionState('connected');
      console.debug('[SSE] Connected successfully');

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const { lines, remainingBuffer } = parseSSEChunk(chunk, buffer);
          buffer = remainingBuffer;

          let currentData: string | null = null;

          for (const line of lines) {
            if (line.startsWith('id:')) {
              lastEventId = line.slice(3).trim();
            } else if (line.startsWith('data:')) {
              currentData = line.slice(5).trim();
            } else if (line.startsWith(':')) {
              // Comment/keep-alive, ignore
              continue;
            }

            if (currentData) {
              const event = parseSSEEvent(currentData);
              if (event) {
                console.debug('[SSE] Received event:', event.type, event.data);
                dispatchEvent(event);
              } else {
                console.warn('[SSE] Failed to parse event:', currentData);
              }
              currentData = null;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Stream ended, schedule reconnect
      retryCount++;
      scheduleReconnect();

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      console.error('SSE connection error:', error);
      retryCount++;
      scheduleReconnect();
    }
  }

  /**
   * Disconnects from the event stream
   */
  function disconnect(): void {
    clearRetryTimeout();

    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    retryCount = 0;
    setConnectionState('disconnected');
  }

  return {
    subscribe(handler: EventHandler): Unsubscribe {
      handlers.add(handler);

      // Start connection if this is the first subscriber
      if (handlers.size === 1 && connectionState === 'disconnected') {
        connect();
      }

      return () => {
        handlers.delete(handler);

        // Disconnect if no more subscribers
        if (handlers.size === 0) {
          disconnect();
        }
      };
    },

    onConnectionStateChange(handler: ConnectionStateHandler): void {
      connectionStateHandler = handler;
      handler(connectionState, retryCount);
    },

    getConnectionState(): ConnectionState {
      return connectionState;
    },

    getRetryCount(): number {
      return retryCount;
    },

    reconnect(): void {
      clearRetryTimeout();
      retryCount = 0;

      if (handlers.size > 0) {
        connect();
      }
    },

    disconnect,

    connect(): void {
      if (connectionState === 'disconnected') {
        connect();
      }
    },
  };
}

export default {
  createEventsApi,
  parseSSEEvent,
  calculateRetryDelay,
  ConnectionError,
};
