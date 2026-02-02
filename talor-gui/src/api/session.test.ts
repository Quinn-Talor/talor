/**
 * Session API Module Tests
 * 会话 API 模块测试
 *
 * Tests for the session API functions.
 *
 * @requirements 2.1 - 创建新会话
 * @requirements 2.2 - 加载会话消息历史
 * @requirements 2.3 - 删除会话
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TalorClient } from './client';
import { createSessionApi, type SessionApi } from './session';
import type { Session, SessionInfo } from '../types/session';
import type { Message } from '../types/message';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('Session API', () => {
  let client: TalorClient;
  let sessionApi: SessionApi;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TalorClient({ baseUrl: 'http://localhost:8000' });
    sessionApi = createSessionApi(client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('should create a new session without metadata', async () => {
      // Backend returns snake_case
      const backendResponse = {
        id: 'session-123',
        title: 'New Session',
        created_at: '2026-02-01T12:00:00.000Z',
        updated_at: '2026-02-01T12:00:00.000Z',
        message_count: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.create();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({});
      // Result should be converted to camelCase
      expect(result.id).toBe('session-123');
      expect(result.title).toBe('New Session');
      expect(typeof result.createdAt).toBe('number');
      expect(typeof result.updatedAt).toBe('number');
    });

    it('should create a new session with title in metadata', async () => {
      const backendResponse = {
        id: 'session-456',
        title: 'Custom Title',
        created_at: '2026-02-01T12:00:00.000Z',
        updated_at: '2026-02-01T12:00:00.000Z',
        message_count: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.create('Custom Title');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ title: 'Custom Title' });
      expect(result.title).toBe('Custom Title');
    });
  });

  describe('get', () => {
    it('should get a session by ID', async () => {
      const backendResponse = {
        id: 'session-123',
        title: 'Test Session',
        created_at: '2026-02-01T12:00:00.000Z',
        updated_at: '2026-02-01T12:00:00.000Z',
        message_count: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.get('session-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions/session-123');
      expect(options.method).toBe('GET');
      expect(result.id).toBe('session-123');
      expect(result.title).toBe('Test Session');
    });

    it('should encode special characters in session ID', async () => {
      const backendResponse = {
        id: 'session/with/slashes',
        title: 'Test Session',
        created_at: '2026-02-01T12:00:00.000Z',
        updated_at: '2026-02-01T12:00:00.000Z',
        message_count: 0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      await sessionApi.get('session/with/slashes');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions/session%2Fwith%2Fslashes');
    });
  });

  describe('list', () => {
    it('should list all sessions without limit', async () => {
      const backendResponse = [
        {
          id: 'session-1',
          title: 'Session 1',
          created_at: '2026-02-01T12:00:00.000Z',
          updated_at: '2026-02-01T12:00:00.000Z',
          message_count: 5,
        },
        {
          id: 'session-2',
          title: 'Session 2',
          created_at: '2026-02-01T11:00:00.000Z',
          updated_at: '2026-02-01T11:30:00.000Z',
          message_count: 10,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.list();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions');
      expect(options.method).toBe('GET');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-1');
      expect(result[0].messageCount).toBe(5);
      expect(result[1].id).toBe('session-2');
      expect(result[1].messageCount).toBe(10);
    });

    it('should list sessions with limit', async () => {
      const backendResponse = [
        {
          id: 'session-1',
          title: 'Session 1',
          created_at: '2026-02-01T12:00:00.000Z',
          updated_at: '2026-02-01T12:00:00.000Z',
          message_count: 5,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.list(10);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions?limit=10');
      expect(options.method).toBe('GET');
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no sessions exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const result = await sessionApi.list();

      expect(result).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete a session by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => undefined,
      });

      await sessionApi.delete('session-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions/session-123');
      expect(options.method).toBe('DELETE');
    });

    it('should encode special characters in session ID for delete', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => undefined,
      });

      await sessionApi.delete('session&id=test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions/session%26id%3Dtest');
    });
  });

  describe('getMessages', () => {
    it('should get messages for a session without limit', async () => {
      const backendResponse = [
        {
          id: 'msg-1',
          session_id: 'session-123',
          role: 'user',
          content: 'Hello',
          created_at: '2026-02-01T11:59:00.000Z',
        },
        {
          id: 'msg-2',
          session_id: 'session-123',
          role: 'assistant',
          content: 'Hi there!',
          created_at: '2026-02-01T12:00:00.000Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.getMessages('session-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions/session-123/messages');
      expect(options.method).toBe('GET');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].sessionId).toBe('session-123');
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello');
      expect(typeof result[0].createdAt).toBe('number');
    });

    it('should get messages for a session with limit', async () => {
      const backendResponse = [
        {
          id: 'msg-1',
          session_id: 'session-123',
          role: 'user',
          content: 'Hello',
          created_at: '2026-02-01T12:00:00.000Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.getMessages('session-123', 50);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/sessions/session-123/messages?limit=50');
      expect(options.method).toBe('GET');
      expect(result).toHaveLength(1);
    });

    it('should return empty array when session has no messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const result = await sessionApi.getMessages('session-123');

      expect(result).toEqual([]);
    });

    it('should handle messages with basic fields', async () => {
      const backendResponse = [
        {
          id: 'msg-1',
          session_id: 'session-123',
          role: 'assistant',
          content: 'Let me help you with that.',
          created_at: '2026-02-01T12:00:00.000Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => backendResponse,
      });

      const result = await sessionApi.getMessages('session-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].sessionId).toBe('session-123');
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Let me help you with that.');
    });
  });

  describe('error handling', () => {
    it('should propagate network errors from client', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Network error'));

      await expect(sessionApi.list()).rejects.toThrow('网络错误');
    });

    it('should handle 404 errors for non-existent sessions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Session not found' }),
      });

      await expect(sessionApi.get('non-existent')).rejects.toThrow();
    });

    it('should handle 500 server errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(sessionApi.create()).rejects.toThrow();
    });
  });

  describe('authentication', () => {
    it('should include auth token in requests when set', async () => {
      client.setAuthToken('test-token-123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await sessionApi.list();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-token-123');
    });

    it('should not include auth header when token is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await sessionApi.list();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });
  });
});
