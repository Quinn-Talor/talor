/**
 * Events API Module Tests
 * 事件 API 模块测试
 *
 * Tests for SSE event subscription, parsing, and reconnection logic.
 *
 * @requirements 1.2 - 建立 WebSocket 或 SSE 连接以订阅事件流
 * @requirements 1.3 - 自动尝试重新连接并显示连接状态
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TalorClient } from './client';
import {
    calculateRetryDelay,
    ConnectionError,
    createEventsApi,
    parseSSEEvent,
    type EventsApi,
} from './events';

// Mock fetch for SSE testing
function createMockSSEResponse(events: Array<{ id?: string; data: string }>) {
  let eventIndex = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async pull(controller) {
      if (eventIndex < events.length) {
        const event = events[eventIndex];
        let chunk = '';
        if (event.id) {
          chunk += `id: ${event.id}\n`;
        }
        chunk += `data: ${event.data}\n\n`;
        controller.enqueue(encoder.encode(chunk));
        eventIndex++;
      } else {
        // Keep connection open with keep-alive
        await new Promise(resolve => setTimeout(resolve, 100));
        controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('parseSSEEvent', () => {
  it('should parse valid Bus event data (new format)', () => {
    const data = JSON.stringify({
      type: 'session.created',
      properties: { session_id: '123' },
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('session.created');
    expect(event?.data).toEqual({ session_id: '123' });
    expect(event?.timestamp).toBe(1234567890);
  });

  it('should parse valid legacy event data', () => {
    const data = JSON.stringify({
      type: 'session.created',
      data: { sessionId: '123' },
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('session.created');
    expect(event?.data).toEqual({ sessionId: '123' });
    expect(event?.timestamp).toBe(1234567890);
  });

  it('should return null for invalid JSON', () => {
    const event = parseSSEEvent('not valid json');
    expect(event).toBeNull();
  });

  it('should return null for missing type field', () => {
    const data = JSON.stringify({
      properties: { session_id: '123' },
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should return null for missing properties/data field', () => {
    const data = JSON.stringify({
      type: 'session.created',
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should return null for missing timestamp field', () => {
    const data = JSON.stringify({
      type: 'session.created',
      properties: { session_id: '123' },
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should return null for null properties field', () => {
    const data = JSON.stringify({
      type: 'session.created',
      properties: null,
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should return null for non-object properties field', () => {
    const data = JSON.stringify({
      type: 'session.created',
      properties: 'string data',
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should return null for non-string type field', () => {
    const data = JSON.stringify({
      type: 123,
      properties: { session_id: '123' },
      timestamp: 1234567890,
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should return null for non-number timestamp field', () => {
    const data = JSON.stringify({
      type: 'session.created',
      properties: { session_id: '123' },
      timestamp: '1234567890',
    });

    const event = parseSSEEvent(data);
    expect(event).toBeNull();
  });

  it('should map Bus event types to frontend event types', () => {
    const mappings = [
      { backend: 'session.created', frontend: 'session.created' },
      { backend: 'session.updated', frontend: 'session.updated' },
      { backend: 'session.deleted', frontend: 'session.deleted' },
      { backend: 'message.created', frontend: 'message.created' },
      { backend: 'message.updated', frontend: 'message.updated' },
      { backend: 'tool.executing', frontend: 'agent.tool_call' },
      { backend: 'tool.executed', frontend: 'agent.tool_call' },
      { backend: 'stream.text', frontend: 'stream.text' },
      { backend: 'stream.done', frontend: 'stream.done' },
    ];

    mappings.forEach(({ backend, frontend }) => {
      const data = JSON.stringify({
        type: backend,
        properties: {},
        timestamp: Date.now(),
      });

      const event = parseSSEEvent(data);
      expect(event).not.toBeNull();
      expect(event?.type).toBe(frontend);
    });
  });
});

describe('calculateRetryDelay', () => {
  it('should return initial delay for first retry', () => {
    const delay = calculateRetryDelay(0, 1000, 30000, 2);
    expect(delay).toBe(1000);
  });

  it('should double delay for each retry with multiplier 2', () => {
    expect(calculateRetryDelay(0, 1000, 30000, 2)).toBe(1000);
    expect(calculateRetryDelay(1, 1000, 30000, 2)).toBe(2000);
    expect(calculateRetryDelay(2, 1000, 30000, 2)).toBe(4000);
    expect(calculateRetryDelay(3, 1000, 30000, 2)).toBe(8000);
  });

  it('should cap delay at maxDelay', () => {
    const delay = calculateRetryDelay(10, 1000, 30000, 2);
    expect(delay).toBe(30000);
  });

  it('should use default values when not provided', () => {
    const delay = calculateRetryDelay(0);
    expect(delay).toBe(1000); // DEFAULT_INITIAL_RETRY_DELAY
  });

  it('should handle custom multiplier', () => {
    expect(calculateRetryDelay(0, 1000, 30000, 3)).toBe(1000);
    expect(calculateRetryDelay(1, 1000, 30000, 3)).toBe(3000);
    expect(calculateRetryDelay(2, 1000, 30000, 3)).toBe(9000);
  });
});

describe('ConnectionError', () => {
  it('should create error with message and retry count', () => {
    const error = new ConnectionError('Connection failed', 3);

    expect(error.message).toBe('Connection failed');
    expect(error.retryCount).toBe(3);
    expect(error.name).toBe('ConnectionError');
  });

  it('should be instanceof Error', () => {
    const error = new ConnectionError('Test', 0);
    expect(error instanceof Error).toBe(true);
  });

  it('should be instanceof ConnectionError', () => {
    const error = new ConnectionError('Test', 0);
    expect(error instanceof ConnectionError).toBe(true);
  });
});

describe('createEventsApi', () => {
  let client: TalorClient;
  let eventsApi: EventsApi;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    client = new TalorClient({ baseUrl: 'http://localhost:8000' });

    // Mock fetch
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    eventsApi = createEventsApi(client, {
      maxRetryCount: 3,
      initialRetryDelay: 100,
      maxRetryDelay: 1000,
      retryDelayMultiplier: 2,
    });
  });

  afterEach(() => {
    eventsApi.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('subscribe', () => {
    it('should create fetch connection on first subscribe when session is subscribed', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      // Must subscribe to a session first (backend requires session_id)
      eventsApi.subscribeToSession('test-session');

      const handler = vi.fn();
      eventsApi.subscribe(handler);

      // Allow async operations to complete
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/event?session_id=test-session',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'text/event-stream',
          }),
        })
      );
    });

    it('should not connect without session subscription', async () => {
      const handler = vi.fn();
      eventsApi.subscribe(handler);

      // Allow async operations to complete
      await vi.advanceTimersByTimeAsync(10);

      // No fetch call should be made without session subscription
      expect(fetchMock).not.toHaveBeenCalled();
      expect(eventsApi.getConnectionState()).toBe('disconnected');
    });

    it('should not create new connection for additional subscribers', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventsApi.subscribe(handler1);
      await vi.advanceTimersByTimeAsync(10);

      eventsApi.subscribe(handler2);
      await vi.advanceTimersByTimeAsync(10);

      // Only one fetch call should be made
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should dispatch events to all handlers', async () => {
      const eventData = JSON.stringify({
        type: 'session.created',
        properties: { session_id: '123' },
        timestamp: 1234567890,
      });

      fetchMock.mockResolvedValueOnce(createMockSSEResponse([
        { id: '1', data: eventData },
      ]));

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventsApi.subscribe(handler1);
      eventsApi.subscribe(handler2);

      // Subscribe to session to receive events
      eventsApi.subscribeToSession('123');

      // Allow async operations to complete
      await vi.advanceTimersByTimeAsync(100);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = eventsApi.subscribe(handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should disconnect when last subscriber unsubscribes', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');

      const handler = vi.fn();
      const unsubscribe = eventsApi.subscribe(handler);

      await vi.advanceTimersByTimeAsync(10);

      unsubscribe();

      expect(eventsApi.getConnectionState()).toBe('disconnected');
    });
  });

  describe('connection state', () => {
    it('should start in disconnected state', () => {
      expect(eventsApi.getConnectionState()).toBe('disconnected');
    });

    it('should transition to connecting when subscribing with session', async () => {
      fetchMock.mockImplementation(() => new Promise(() => {})); // Never resolves

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');
      eventsApi.subscribe(vi.fn());

      expect(eventsApi.getConnectionState()).toBe('connecting');
    });

    it('should transition to connected on successful response', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');
      eventsApi.subscribe(vi.fn());

      await vi.advanceTimersByTimeAsync(10);

      expect(eventsApi.getConnectionState()).toBe('connected');
    });

    it('should notify state change handler', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      const stateHandler = vi.fn();
      eventsApi.onConnectionStateChange(stateHandler);

      // Should be called immediately with current state
      expect(stateHandler).toHaveBeenCalledWith('disconnected', 0);

      // Subscribe to a session first (required for connection)
      eventsApi.subscribeToSession('test-session');

      eventsApi.subscribe(vi.fn());
      expect(stateHandler).toHaveBeenCalledWith('connecting', 0);

      await vi.advanceTimersByTimeAsync(10);
      expect(stateHandler).toHaveBeenCalledWith('connected', 0);
    });

    it('should reset retry count on successful connection', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');
      eventsApi.subscribe(vi.fn());

      await vi.advanceTimersByTimeAsync(10);

      expect(eventsApi.getRetryCount()).toBe(0);
    });
  });

  describe('session subscription (client-side filtering)', () => {
    it('should filter events by subscribed sessions', async () => {
      const event1 = JSON.stringify({
        type: 'message.created',
        properties: { session_id: 'session-1', message_id: 'msg-1' },
        timestamp: Date.now(),
      });
      const event2 = JSON.stringify({
        type: 'message.created',
        properties: { session_id: 'session-2', message_id: 'msg-2' },
        timestamp: Date.now(),
      });

      fetchMock.mockResolvedValueOnce(createMockSSEResponse([
        { id: '1', data: event1 },
        { id: '2', data: event2 },
      ]));

      const handler = vi.fn();
      eventsApi.subscribe(handler);

      // Only subscribe to session-1
      eventsApi.subscribeToSession('session-1');

      await vi.advanceTimersByTimeAsync(200);

      // Should only receive event for session-1
      const calls = handler.mock.calls;
      const receivedSessionIds = calls.map(call => call[0]?.data?.session_id);

      expect(receivedSessionIds).toContain('session-1');
      expect(receivedSessionIds).not.toContain('session-2');
    });

    it('should only allow one session subscription at a time', async () => {
      eventsApi.subscribeToSession('session-1');
      expect(eventsApi.getSubscribedSessions()).toEqual(['session-1']);

      // Subscribing to another session replaces the previous one
      eventsApi.subscribeToSession('session-2');
      expect(eventsApi.getSubscribedSessions()).toEqual(['session-2']);
      expect(eventsApi.getSubscribedSessions()).toHaveLength(1);
    });

    it('should allow unsubscribing from current session', async () => {
      eventsApi.subscribeToSession('session-1');
      expect(eventsApi.getSubscribedSessions()).toEqual(['session-1']);

      eventsApi.unsubscribeFromSession('session-1');

      expect(eventsApi.getSubscribedSessions()).toEqual([]);
      expect(eventsApi.getSubscribedSessions()).toHaveLength(0);
    });

    it('should ignore unsubscribe for non-current session', async () => {
      eventsApi.subscribeToSession('session-1');

      // Unsubscribing from a different session should have no effect
      eventsApi.unsubscribeFromSession('session-2');

      expect(eventsApi.getSubscribedSessions()).toEqual(['session-1']);
    });

    it('should check if subscribed to a session', () => {
      eventsApi.subscribeToSession('session-1');

      expect(eventsApi.isSubscribedToSession('session-1')).toBe(true);
      expect(eventsApi.isSubscribedToSession('session-2')).toBe(false);
    });

    it('should not connect when no sessions are subscribed', async () => {
      const handler = vi.fn();
      eventsApi.subscribe(handler);

      // Don't subscribe to any session

      await vi.advanceTimersByTimeAsync(200);

      // Should not connect without session subscription
      expect(fetchMock).not.toHaveBeenCalled();
      expect(eventsApi.getConnectionState()).toBe('disconnected');
    });

    it('should dispatch global events (no session_id) when connected', async () => {
      const globalEvent = JSON.stringify({
        type: 'mcp.server_connected',
        properties: { serverName: 'test-server' },
        timestamp: Date.now(),
      });

      fetchMock.mockResolvedValueOnce(createMockSSEResponse([
        { id: '1', data: globalEvent },
      ]));

      const handler = vi.fn();

      // Must subscribe to a session to establish connection
      eventsApi.subscribeToSession('test-session');
      eventsApi.subscribe(handler);

      await vi.advanceTimersByTimeAsync(200);

      // Should receive global events
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should reset state on disconnect', async () => {
      fetchMock.mockResolvedValueOnce(createMockSSEResponse([]));

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');
      eventsApi.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(10);

      eventsApi.disconnect();

      expect(eventsApi.getConnectionState()).toBe('disconnected');
      expect(eventsApi.getRetryCount()).toBe(0);
    });
  });

  describe('manual reconnection', () => {
    it('should allow manual reconnection', async () => {
      fetchMock.mockResolvedValue(createMockSSEResponse([]));

      // Subscribe to session first
      eventsApi.subscribeToSession('test-session');
      eventsApi.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(10);

      eventsApi.disconnect();
      expect(eventsApi.getConnectionState()).toBe('disconnected');

      // Manual reconnect
      eventsApi.reconnect();

      expect(eventsApi.getRetryCount()).toBe(0);
    });

    it('should not reconnect if no subscribers', () => {
      eventsApi.reconnect();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('session subscription triggers reconnection', () => {
    it('should reconnect when switching sessions', async () => {
      fetchMock.mockResolvedValue(createMockSSEResponse([]));

      // Subscribe to first session
      eventsApi.subscribeToSession('session-1');
      eventsApi.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:8000/event?session_id=session-1',
        expect.anything()
      );

      // Switch to another session - should trigger reconnection
      eventsApi.subscribeToSession('session-2');
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:8000/event?session_id=session-2',
        expect.anything()
      );
    });

    it('should not reconnect when subscribing to same session', async () => {
      fetchMock.mockResolvedValue(createMockSSEResponse([]));

      eventsApi.subscribeToSession('session-1');
      eventsApi.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Subscribe to same session again - should not reconnect
      eventsApi.subscribeToSession('session-1');
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should disconnect when unsubscribing from current session', async () => {
      fetchMock.mockResolvedValue(createMockSSEResponse([]));

      eventsApi.subscribeToSession('session-1');
      eventsApi.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(10);

      expect(eventsApi.getConnectionState()).toBe('connected');

      // Unsubscribe from current session
      eventsApi.unsubscribeFromSession('session-1');

      expect(eventsApi.getConnectionState()).toBe('disconnected');
    });
  });
});
