/**
 * Tests for TalorClient API client base class
 * TalorClient API 客户端基础类测试
 *
 * @requirements 1.1 - HTTP 连接到 Talor_Backend 的 REST API
 * @requirements 1.5 - 包含必要的认证信息
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TalorClient,
  TalorClientConfig,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ServerError,
} from './client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TalorClient', () => {
  let client: TalorClient;
  const baseUrl = 'http://localhost:8000';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TalorClient({ baseUrl });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with base URL', () => {
      expect(client.getBaseUrl()).toBe(baseUrl);
    });

    it('should remove trailing slash from base URL', () => {
      const clientWithSlash = new TalorClient({ baseUrl: 'http://localhost:8000/' });
      expect(clientWithSlash.getBaseUrl()).toBe('http://localhost:8000');
    });

    it('should use default timeout when not specified', () => {
      expect(client.getTimeout()).toBe(30000);
    });

    it('should use custom timeout when specified', () => {
      const clientWithTimeout = new TalorClient({ baseUrl, timeout: 5000 });
      expect(clientWithTimeout.getTimeout()).toBe(5000);
    });
  });

  describe('authentication', () => {
    it('should start with no auth token', () => {
      expect(client.getAuthToken()).toBeNull();
    });

    it('should set and get auth token', () => {
      client.setAuthToken('test-token');
      expect(client.getAuthToken()).toBe('test-token');
    });

    it('should clear auth token when set to null', () => {
      client.setAuthToken('test-token');
      client.setAuthToken(null);
      expect(client.getAuthToken()).toBeNull();
    });

    it('should include Authorization header when token is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'test' }),
      });

      client.setAuthToken('my-secret-token');
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/test`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        })
      );
    });

    it('should not include Authorization header when token is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'test' }),
      });

      await client.get('/test');

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).not.toHaveProperty('Authorization');
    });
  });

  describe('HTTP methods', () => {
    describe('GET', () => {
      it('should make GET request to correct URL', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, name: 'test' }),
        });

        const result = await client.get<{ id: number; name: string }>('/users/1');

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/users/1`,
          expect.objectContaining({
            method: 'GET',
          })
        );
        expect(result).toEqual({ id: 1, name: 'test' });
      });

      it('should include Content-Type header', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });

        await client.get('/test');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          })
        );
      });
    });

    describe('POST', () => {
      it('should make POST request with body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 1, name: 'new user' }),
        });

        const body = { name: 'new user' };
        const result = await client.post<{ id: number; name: string }>('/users', body);

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/users`,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(body),
          })
        );
        expect(result).toEqual({ id: 1, name: 'new user' });
      });

      it('should handle POST without body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

        await client.post('/action');

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/action`,
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    describe('PUT', () => {
      it('should make PUT request with body', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, name: 'updated' }),
        });

        const body = { name: 'updated' };
        const result = await client.put<{ id: number; name: string }>('/users/1', body);

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/users/1`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify(body),
          })
        );
        expect(result).toEqual({ id: 1, name: 'updated' });
      });
    });

    describe('DELETE', () => {
      it('should make DELETE request', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => {
            throw new Error('No content');
          },
        });

        const result = await client.delete('/users/1');

        expect(mockFetch).toHaveBeenCalledWith(
          `${baseUrl}/users/1`,
          expect.objectContaining({
            method: 'DELETE',
          })
        );
        expect(result).toBeUndefined();
      });
    });
  });

  describe('error handling', () => {
    it('should throw NetworkError for non-OK responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid input' }),
      });

      await expect(client.get('/test')).rejects.toThrow(NetworkError);
    });

    it('should throw AuthenticationError for 401 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid token' }),
      });

      await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
    });

    it('should throw NotFoundError for 404 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Resource not found' }),
      });

      await expect(client.get('/test')).rejects.toThrow(NotFoundError);
    });

    it('should throw ServerError for 500 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(client.get('/test')).rejects.toThrow(ServerError);
    });

    it('should throw ServerError for 503 responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'Service unavailable' }),
      });

      await expect(client.get('/test')).rejects.toThrow(ServerError);
    });

    it('should include status code in NetworkError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Bad request' }),
      });

      try {
        await client.get('/test');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as NetworkError).statusCode).toBe(400);
      }
    });

    it('should include response body in NetworkError', async () => {
      const errorBody = { error: 'Validation failed', details: ['field1 is required'] };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => errorBody,
      });

      try {
        await client.get('/test');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as NetworkError).response).toEqual(errorBody);
      }
    });

    it('should handle network errors (fetch failure)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(client.get('/test')).rejects.toThrow(NetworkError);
    });

    it('should call onError callback when error occurs', async () => {
      const onError = vi.fn();
      const clientWithErrorHandler = new TalorClient({ baseUrl, onError });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(clientWithErrorHandler.get('/test')).rejects.toThrow();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('should abort request on timeout', async () => {
      // Mock fetch to simulate a slow request that gets aborted
      mockFetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Listen for abort signal
            if (options.signal) {
              options.signal.addEventListener('abort', () => {
                const abortError = new Error('The operation was aborted');
                abortError.name = 'AbortError';
                reject(abortError);
              });
            }
          })
      );

      // Use a very short timeout to trigger quickly
      const clientWithShortTimeout = new TalorClient({ baseUrl, timeout: 50 });

      await expect(clientWithShortTimeout.get('/slow')).rejects.toThrow(NetworkError);
    }, 10000); // Increase test timeout to allow for the actual timeout to occur

    it('should include timeout duration in error message', async () => {
      mockFetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (options.signal) {
              options.signal.addEventListener('abort', () => {
                const abortError = new Error('The operation was aborted');
                abortError.name = 'AbortError';
                reject(abortError);
              });
            }
          })
      );

      const clientWithShortTimeout = new TalorClient({ baseUrl, timeout: 50 });

      try {
        await clientWithShortTimeout.get('/slow');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as NetworkError).message).toContain('50ms');
      }
    }, 10000);
  });

  describe('custom headers', () => {
    it('should merge custom headers with default headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await client.get('/test', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });

    it('should allow custom headers to override defaults', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await client.post('/test', {}, {
        headers: { 'Content-Type': 'text/plain' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'text/plain',
          }),
        })
      );
    });
  });
});

describe('Error classes', () => {
  describe('NetworkError', () => {
    it('should have correct name', () => {
      const error = new NetworkError('Test error');
      expect(error.name).toBe('NetworkError');
    });

    it('should store status code', () => {
      const error = new NetworkError('Test error', 400);
      expect(error.statusCode).toBe(400);
    });

    it('should store response', () => {
      const response = { error: 'details' };
      const error = new NetworkError('Test error', 400, response);
      expect(error.response).toEqual(response);
    });

    it('should be instanceof Error', () => {
      const error = new NetworkError('Test error');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('AuthenticationError', () => {
    it('should have correct name', () => {
      const error = new AuthenticationError();
      expect(error.name).toBe('AuthenticationError');
    });

    it('should have status code 401', () => {
      const error = new AuthenticationError();
      expect(error.statusCode).toBe(401);
    });

    it('should be instanceof NetworkError', () => {
      const error = new AuthenticationError();
      expect(error).toBeInstanceOf(NetworkError);
    });
  });

  describe('NotFoundError', () => {
    it('should have correct name', () => {
      const error = new NotFoundError();
      expect(error.name).toBe('NotFoundError');
    });

    it('should have status code 404', () => {
      const error = new NotFoundError();
      expect(error.statusCode).toBe(404);
    });

    it('should be instanceof NetworkError', () => {
      const error = new NotFoundError();
      expect(error).toBeInstanceOf(NetworkError);
    });
  });

  describe('ServerError', () => {
    it('should have correct name', () => {
      const error = new ServerError();
      expect(error.name).toBe('ServerError');
    });

    it('should have default status code 500', () => {
      const error = new ServerError();
      expect(error.statusCode).toBe(500);
    });

    it('should accept custom status code', () => {
      const error = new ServerError('Service unavailable', 503);
      expect(error.statusCode).toBe(503);
    });

    it('should be instanceof NetworkError', () => {
      const error = new ServerError();
      expect(error).toBeInstanceOf(NetworkError);
    });
  });
});
