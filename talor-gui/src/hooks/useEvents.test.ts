/**
 * useEvents Hook Tests
 * 事件处理 Hook 测试
 *
 * Tests for the useEvents hook implementation.
 *
 * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
 * @requirements 8.3 - MCP 服务器连接状态变化时实时更新显示
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useEvents,
  createEventHandler,
  extractSessionEventData,
  extractMessageEventData,
  extractPermissionRequestEventData,
  extractMCPServerEventData,
  type EventHandlers,
  type StoreCallbacks,
} from './useEvents';
import type { EventsApi, ConnectionState } from '../api/events';
import type { Event } from '../types/event';

/**
 * Creates a mock EventsApi
 * 创建模拟的 EventsApi
 */
function createMockEventsApi(overrides: Partial<EventsApi> = {}): EventsApi {
  return {
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    onConnectionStateChange: vi.fn(),
    getConnectionState: vi.fn().mockReturnValue('disconnected' as ConnectionState),
    getRetryCount: vi.fn().mockReturnValue(0),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates a mock Event
 * 创建模拟的事件
 */
function createMockEvent(overrides: Partial<Event> = {}): Event {
  return {
    type: 'session.created',
    data: { sessionId: 'test-session' },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('extractSessionEventData', () => {
  it('should extract valid session event data', () => {
    const data = { sessionId: 'session-1', title: 'Test Session' };
    const result = extractSessionEventData(data);

    expect(result).toEqual({
      sessionId: 'session-1',
      title: 'Test Session',
    });
  });

  it('should return null for missing sessionId', () => {
    const data = { title: 'Test Session' };
    const result = extractSessionEventData(data);

    expect(result).toBeNull();
  });

  it('should return null for non-string sessionId', () => {
    const data = { sessionId: 123, title: 'Test Session' };
    const result = extractSessionEventData(data);

    expect(result).toBeNull();
  });

  it('should handle missing title', () => {
    const data = { sessionId: 'session-1' };
    const result = extractSessionEventData(data);

    expect(result).toEqual({
      sessionId: 'session-1',
      title: undefined,
    });
  });

  it('should ignore non-string title', () => {
    const data = { sessionId: 'session-1', title: 123 };
    const result = extractSessionEventData(data);

    expect(result).toEqual({
      sessionId: 'session-1',
      title: undefined,
    });
  });
});

describe('extractMessageEventData', () => {
  it('should extract valid message event data', () => {
    const data = { messageId: 'msg-1', sessionId: 'session-1', content: 'Hello' };
    const result = extractMessageEventData(data);

    expect(result).toEqual({
      messageId: 'msg-1',
      sessionId: 'session-1',
      content: 'Hello',
    });
  });

  it('should return null for missing messageId', () => {
    const data = { sessionId: 'session-1', content: 'Hello' };
    const result = extractMessageEventData(data);

    expect(result).toBeNull();
  });

  it('should return null for missing sessionId', () => {
    const data = { messageId: 'msg-1', content: 'Hello' };
    const result = extractMessageEventData(data);

    expect(result).toBeNull();
  });

  it('should return null for non-string messageId', () => {
    const data = { messageId: 123, sessionId: 'session-1' };
    const result = extractMessageEventData(data);

    expect(result).toBeNull();
  });

  it('should handle missing content', () => {
    const data = { messageId: 'msg-1', sessionId: 'session-1' };
    const result = extractMessageEventData(data);

    expect(result).toEqual({
      messageId: 'msg-1',
      sessionId: 'session-1',
      content: undefined,
    });
  });
});

describe('extractPermissionRequestEventData', () => {
  it('should extract valid permission request event data', () => {
    const data = {
      requestId: 'req-1',
      sessionId: 'session-1',
      toolName: 'file_write',
      arguments: { path: '/test.txt' },
      description: 'Write to file',
    };
    const result = extractPermissionRequestEventData(data);

    expect(result).toEqual({
      requestId: 'req-1',
      sessionId: 'session-1',
      toolName: 'file_write',
      arguments: { path: '/test.txt' },
      description: 'Write to file',
    });
  });

  it('should return null for missing requestId', () => {
    const data = { sessionId: 'session-1', toolName: 'file_write' };
    const result = extractPermissionRequestEventData(data);

    expect(result).toBeNull();
  });

  it('should return null for missing sessionId', () => {
    const data = { requestId: 'req-1', toolName: 'file_write' };
    const result = extractPermissionRequestEventData(data);

    expect(result).toBeNull();
  });

  it('should return null for missing toolName', () => {
    const data = { requestId: 'req-1', sessionId: 'session-1' };
    const result = extractPermissionRequestEventData(data);

    expect(result).toBeNull();
  });

  it('should handle missing arguments', () => {
    const data = { requestId: 'req-1', sessionId: 'session-1', toolName: 'file_write' };
    const result = extractPermissionRequestEventData(data);

    expect(result?.arguments).toEqual({});
  });

  it('should handle missing description', () => {
    const data = { requestId: 'req-1', sessionId: 'session-1', toolName: 'file_write' };
    const result = extractPermissionRequestEventData(data);

    expect(result?.description).toBe('');
  });

  it('should handle null arguments', () => {
    const data = {
      requestId: 'req-1',
      sessionId: 'session-1',
      toolName: 'file_write',
      arguments: null,
    };
    const result = extractPermissionRequestEventData(data);

    expect(result?.arguments).toEqual({});
  });
});

describe('extractMCPServerEventData', () => {
  it('should extract valid MCP server event data', () => {
    const data = { serverId: 'server-1', serverName: 'Test Server', error: 'Connection lost' };
    const result = extractMCPServerEventData(data);

    expect(result).toEqual({
      serverId: 'server-1',
      serverName: 'Test Server',
      error: 'Connection lost',
    });
  });

  it('should return null for missing serverId', () => {
    const data = { serverName: 'Test Server' };
    const result = extractMCPServerEventData(data);

    expect(result).toBeNull();
  });

  it('should return null for missing serverName', () => {
    const data = { serverId: 'server-1' };
    const result = extractMCPServerEventData(data);

    expect(result).toBeNull();
  });

  it('should handle missing error', () => {
    const data = { serverId: 'server-1', serverName: 'Test Server' };
    const result = extractMCPServerEventData(data);

    expect(result).toEqual({
      serverId: 'server-1',
      serverName: 'Test Server',
      error: undefined,
    });
  });
});

describe('createEventHandler', () => {
  let handlers: EventHandlers;
  let storeCallbacks: StoreCallbacks;

  beforeEach(() => {
    handlers = {
      onSessionCreated: vi.fn(),
      onSessionUpdated: vi.fn(),
      onSessionDeleted: vi.fn(),
      onMessageCreated: vi.fn(),
      onMessageUpdated: vi.fn(),
      onPermissionRequested: vi.fn(),
      onMCPServerConnected: vi.fn(),
      onMCPServerDisconnected: vi.fn(),
    };

    storeCallbacks = {
      addSession: vi.fn(),
      updateSession: vi.fn(),
      removeSession: vi.fn(),
      addMessage: vi.fn(),
      updateMessage: vi.fn(),
      showPermissionDialog: vi.fn(),
      updateMCPServerStatus: vi.fn(),
    };
  });

  describe('session.created event', () => {
    it('should call onSessionCreated handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.created',
        data: { sessionId: 'session-1', title: 'New Session' },
        timestamp: 1000,
      });

      eventHandler(event);

      expect(handlers.onSessionCreated).toHaveBeenCalledWith({
        sessionId: 'session-1',
        title: 'New Session',
      });
    });

    it('should call addSession store callback', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.created',
        data: { sessionId: 'session-1', title: 'New Session' },
        timestamp: 1000,
      });

      eventHandler(event);

      expect(storeCallbacks.addSession).toHaveBeenCalledWith({
        id: 'session-1',
        title: 'New Session',
        createdAt: 1000,
        updatedAt: 1000,
        messageCount: 0,
      });
    });

    it('should use default title when not provided', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.created',
        data: { sessionId: 'session-1' },
        timestamp: 1000,
      });

      eventHandler(event);

      expect(storeCallbacks.addSession).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Session' })
      );
    });

    it('should not call callbacks for invalid data', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.created',
        data: { title: 'No Session ID' },
      });

      eventHandler(event);

      expect(handlers.onSessionCreated).not.toHaveBeenCalled();
      expect(storeCallbacks.addSession).not.toHaveBeenCalled();
    });
  });

  describe('session.updated event', () => {
    it('should call onSessionUpdated handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.updated',
        data: { sessionId: 'session-1', title: 'Updated Title' },
        timestamp: 2000,
      });

      eventHandler(event);

      expect(handlers.onSessionUpdated).toHaveBeenCalledWith({
        sessionId: 'session-1',
        title: 'Updated Title',
      });
    });

    it('should call updateSession store callback', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.updated',
        data: { sessionId: 'session-1', title: 'Updated Title' },
        timestamp: 2000,
      });

      eventHandler(event);

      expect(storeCallbacks.updateSession).toHaveBeenCalledWith('session-1', {
        updatedAt: 2000,
        title: 'Updated Title',
      });
    });

    it('should not include title in updates when not provided', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.updated',
        data: { sessionId: 'session-1' },
        timestamp: 2000,
      });

      eventHandler(event);

      expect(storeCallbacks.updateSession).toHaveBeenCalledWith('session-1', {
        updatedAt: 2000,
      });
    });
  });

  describe('session.deleted event', () => {
    it('should call onSessionDeleted handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.deleted',
        data: { sessionId: 'session-1' },
      });

      eventHandler(event);

      expect(handlers.onSessionDeleted).toHaveBeenCalledWith({
        sessionId: 'session-1',
        title: undefined,
      });
    });

    it('should call removeSession store callback', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'session.deleted',
        data: { sessionId: 'session-1' },
      });

      eventHandler(event);

      expect(storeCallbacks.removeSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('message.created event', () => {
    it('should call onMessageCreated handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'message.created',
        data: { messageId: 'msg-1', sessionId: 'session-1', content: 'Hello', role: 'user' },
        timestamp: 1000,
      });

      eventHandler(event);

      expect(handlers.onMessageCreated).toHaveBeenCalledWith({
        messageId: 'msg-1',
        sessionId: 'session-1',
        content: 'Hello',
      });
    });

    it('should call addMessage store callback', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'message.created',
        data: { messageId: 'msg-1', sessionId: 'session-1', content: 'Hello', role: 'user' },
        timestamp: 1000,
      });

      eventHandler(event);

      expect(storeCallbacks.addMessage).toHaveBeenCalledWith({
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Hello',
        createdAt: 1000,
      });
    });

    it('should default to assistant role when not provided', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'message.created',
        data: { messageId: 'msg-1', sessionId: 'session-1', content: 'Hello' },
        timestamp: 1000,
      });

      eventHandler(event);

      expect(storeCallbacks.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant' })
      );
    });
  });

  describe('message.updated event', () => {
    it('should call onMessageUpdated handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'message.updated',
        data: { messageId: 'msg-1', sessionId: 'session-1', content: 'Updated content' },
      });

      eventHandler(event);

      expect(handlers.onMessageUpdated).toHaveBeenCalledWith({
        messageId: 'msg-1',
        sessionId: 'session-1',
        content: 'Updated content',
      });
    });

    it('should call updateMessage store callback', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'message.updated',
        data: { messageId: 'msg-1', sessionId: 'session-1', content: 'Updated content' },
      });

      eventHandler(event);

      expect(storeCallbacks.updateMessage).toHaveBeenCalledWith('msg-1', {
        content: 'Updated content',
      });
    });

    it('should not call updateMessage when content is undefined', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'message.updated',
        data: { messageId: 'msg-1', sessionId: 'session-1' },
      });

      eventHandler(event);

      expect(storeCallbacks.updateMessage).not.toHaveBeenCalled();
    });
  });

  describe('permission.requested event', () => {
    it('should call onPermissionRequested handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'permission.requested',
        data: {
          requestId: 'req-1',
          sessionId: 'session-1',
          toolName: 'file_write',
          arguments: { path: '/test.txt' },
          description: 'Write to file',
        },
      });

      eventHandler(event);

      expect(handlers.onPermissionRequested).toHaveBeenCalledWith({
        requestId: 'req-1',
        sessionId: 'session-1',
        toolName: 'file_write',
        arguments: { path: '/test.txt' },
        description: 'Write to file',
      });
    });

    it('should call showPermissionDialog store callback', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'permission.requested',
        data: {
          requestId: 'req-1',
          sessionId: 'session-1',
          toolName: 'file_write',
          arguments: { path: '/test.txt' },
          description: 'Write to file',
        },
      });

      eventHandler(event);

      expect(storeCallbacks.showPermissionDialog).toHaveBeenCalledWith({
        id: 'req-1',
        sessionId: 'session-1',
        toolName: 'file_write',
        arguments: { path: '/test.txt' },
        description: 'Write to file',
      });
    });
  });

  describe('mcp.server_connected event', () => {
    it('should call onMCPServerConnected handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'mcp.server_connected',
        data: { serverId: 'server-1', serverName: 'Test Server' },
      });

      eventHandler(event);

      expect(handlers.onMCPServerConnected).toHaveBeenCalledWith({
        serverId: 'server-1',
        serverName: 'Test Server',
        error: undefined,
      });
    });

    it('should call updateMCPServerStatus store callback with connected=true', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'mcp.server_connected',
        data: { serverId: 'server-1', serverName: 'Test Server' },
      });

      eventHandler(event);

      expect(storeCallbacks.updateMCPServerStatus).toHaveBeenCalledWith('server-1', true);
    });
  });

  describe('mcp.server_disconnected event', () => {
    it('should call onMCPServerDisconnected handler', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'mcp.server_disconnected',
        data: { serverId: 'server-1', serverName: 'Test Server', error: 'Connection lost' },
      });

      eventHandler(event);

      expect(handlers.onMCPServerDisconnected).toHaveBeenCalledWith({
        serverId: 'server-1',
        serverName: 'Test Server',
        error: 'Connection lost',
      });
    });

    it('should call updateMCPServerStatus store callback with connected=false', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'mcp.server_disconnected',
        data: { serverId: 'server-1', serverName: 'Test Server', error: 'Connection lost' },
      });

      eventHandler(event);

      expect(storeCallbacks.updateMCPServerStatus).toHaveBeenCalledWith(
        'server-1',
        false,
        'Connection lost'
      );
    });
  });

  describe('unknown event type', () => {
    it('should not throw for unknown event types', () => {
      const eventHandler = createEventHandler(handlers, storeCallbacks);
      const event = createMockEvent({
        type: 'unknown.event' as Event['type'],
        data: {},
      });

      expect(() => eventHandler(event)).not.toThrow();
    });
  });

  describe('missing callbacks', () => {
    it('should handle missing store callbacks gracefully', () => {
      const eventHandler = createEventHandler(handlers, {});
      const event = createMockEvent({
        type: 'session.created',
        data: { sessionId: 'session-1' },
      });

      expect(() => eventHandler(event)).not.toThrow();
      expect(handlers.onSessionCreated).toHaveBeenCalled();
    });

    it('should handle missing handlers gracefully', () => {
      const eventHandler = createEventHandler({}, storeCallbacks);
      const event = createMockEvent({
        type: 'session.created',
        data: { sessionId: 'session-1' },
      });

      expect(() => eventHandler(event)).not.toThrow();
      expect(storeCallbacks.addSession).toHaveBeenCalled();
    });
  });
});

describe('useEvents hook', () => {
  let mockEventsApi: EventsApi;

  beforeEach(() => {
    mockEventsApi = createMockEventsApi();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return disconnected state when eventsApi is null', () => {
    const { result } = renderHook(() =>
      useEvents({
        eventsApi: null,
      })
    );

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.retryCount).toBe(0);
  });

  it('should subscribe to events on mount', () => {
    renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
      })
    );

    expect(mockEventsApi.subscribe).toHaveBeenCalled();
  });

  it('should not subscribe when autoConnect is false', () => {
    renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
        autoConnect: false,
      })
    );

    expect(mockEventsApi.subscribe).not.toHaveBeenCalled();
  });

  it('should unsubscribe on unmount', () => {
    const unsubscribe = vi.fn();
    mockEventsApi = createMockEventsApi({
      subscribe: vi.fn().mockReturnValue(unsubscribe),
    });

    const { unmount } = renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
      })
    );

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('should set up connection state handler', () => {
    renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
      })
    );

    expect(mockEventsApi.onConnectionStateChange).toHaveBeenCalled();
  });

  it('should call reconnect on eventsApi', () => {
    const { result } = renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
      })
    );

    act(() => {
      result.current.reconnect();
    });

    expect(mockEventsApi.reconnect).toHaveBeenCalled();
  });

  it('should call disconnect on eventsApi', () => {
    const { result } = renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
      })
    );

    act(() => {
      result.current.disconnect();
    });

    expect(mockEventsApi.disconnect).toHaveBeenCalled();
  });

  it('should return connection state from eventsApi', () => {
    mockEventsApi = createMockEventsApi({
      getConnectionState: vi.fn().mockReturnValue('connected'),
      getRetryCount: vi.fn().mockReturnValue(2),
    });

    const { result } = renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
      })
    );

    expect(result.current.connectionState).toBe('connected');
    expect(result.current.retryCount).toBe(2);
  });

  it('should call custom handlers when events are received', () => {
    const onSessionCreated = vi.fn();
    let capturedEventHandler: ((event: Event) => void) | null = null;

    mockEventsApi = createMockEventsApi({
      subscribe: vi.fn().mockImplementation((handler) => {
        capturedEventHandler = handler;
        return vi.fn();
      }),
    });

    renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
        handlers: { onSessionCreated },
      })
    );

    // Simulate receiving an event
    const event: Event = {
      type: 'session.created',
      data: { sessionId: 'session-1', title: 'Test' },
      timestamp: Date.now(),
    };

    act(() => {
      capturedEventHandler?.(event);
    });

    expect(onSessionCreated).toHaveBeenCalledWith({
      sessionId: 'session-1',
      title: 'Test',
    });
  });

  it('should call store callbacks when events are received', () => {
    const addSession = vi.fn();
    let capturedEventHandler: ((event: Event) => void) | null = null;

    mockEventsApi = createMockEventsApi({
      subscribe: vi.fn().mockImplementation((handler) => {
        capturedEventHandler = handler;
        return vi.fn();
      }),
    });

    renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
        storeCallbacks: { addSession },
      })
    );

    // Simulate receiving an event
    const event: Event = {
      type: 'session.created',
      data: { sessionId: 'session-1', title: 'Test' },
      timestamp: 1000,
    };

    act(() => {
      capturedEventHandler?.(event);
    });

    expect(addSession).toHaveBeenCalledWith({
      id: 'session-1',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 1000,
      messageCount: 0,
    });
  });

  it('should call connection state change handler', () => {
    const onConnectionStateChange = vi.fn();
    const setConnectionState = vi.fn();
    let capturedStateHandler: ((state: ConnectionState, retryCount?: number) => void) | null = null;

    mockEventsApi = createMockEventsApi({
      onConnectionStateChange: vi.fn().mockImplementation((handler) => {
        capturedStateHandler = handler;
      }),
    });

    renderHook(() =>
      useEvents({
        eventsApi: mockEventsApi,
        handlers: { onConnectionStateChange },
        storeCallbacks: { setConnectionState },
      })
    );

    // Simulate connection state change
    act(() => {
      capturedStateHandler?.('connected', 0);
    });

    expect(onConnectionStateChange).toHaveBeenCalledWith('connected', 0);
    expect(setConnectionState).toHaveBeenCalledWith('connected', 0);
  });

  it('should handle reconnect when eventsApi is null', () => {
    const { result } = renderHook(() =>
      useEvents({
        eventsApi: null,
      })
    );

    // Should not throw
    expect(() => {
      act(() => {
        result.current.reconnect();
      });
    }).not.toThrow();
  });

  it('should handle disconnect when eventsApi is null', () => {
    const { result } = renderHook(() =>
      useEvents({
        eventsApi: null,
      })
    );

    // Should not throw
    expect(() => {
      act(() => {
        result.current.disconnect();
      });
    }).not.toThrow();
  });
});
