/**
 * Agent API Module Tests
 * 代理 API 模块测试
 *
 * Tests for the agent API module including SSE parsing and streaming response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TalorClient } from './client';
import { createAgentApi, parseSSEChunk, parseSSEDataLine } from './agent';
import type { AgentApi } from './agent';
import type { AgentResponse } from '../types/api';

describe('Agent API Module', () => {
  describe('parseSSEChunk', () => {
    it('should parse complete lines from a chunk', () => {
      const chunk = 'data: {"event":"text","content":"Hello"}\n';
      const { lines, remainingBuffer } = parseSSEChunk(chunk, '');

      expect(lines).toEqual(['data: {"event":"text","content":"Hello"}']);
      expect(remainingBuffer).toBe('');
    });

    it('should handle multiple lines in a chunk', () => {
      const chunk =
        'data: {"event":"text","content":"Hello"}\ndata: {"event":"text","content":"World"}\n';
      const { lines, remainingBuffer } = parseSSEChunk(chunk, '');

      expect(lines).toEqual([
        'data: {"event":"text","content":"Hello"}',
        'data: {"event":"text","content":"World"}',
      ]);
      expect(remainingBuffer).toBe('');
    });

    it('should buffer incomplete lines', () => {
      const chunk = 'data: {"event":"text","content":"Hel';
      const { lines, remainingBuffer } = parseSSEChunk(chunk, '');

      expect(lines).toEqual([]);
      expect(remainingBuffer).toBe('data: {"event":"text","content":"Hel');
    });

    it('should combine buffer with new chunk', () => {
      const buffer = 'data: {"event":"text","content":"Hel';
      const chunk = 'lo"}\n';
      const { lines, remainingBuffer } = parseSSEChunk(chunk, buffer);

      expect(lines).toEqual(['data: {"event":"text","content":"Hello"}']);
      expect(remainingBuffer).toBe('');
    });

    it('should filter out empty lines', () => {
      const chunk = 'data: {"event":"text","content":"Hello"}\n\n\ndata: {"event":"text","content":"World"}\n';
      const { lines, remainingBuffer } = parseSSEChunk(chunk, '');

      expect(lines).toEqual([
        'data: {"event":"text","content":"Hello"}',
        'data: {"event":"text","content":"World"}',
      ]);
      expect(remainingBuffer).toBe('');
    });

    it('should handle chunks with only newlines', () => {
      const chunk = '\n\n\n';
      const { lines, remainingBuffer } = parseSSEChunk(chunk, '');

      expect(lines).toEqual([]);
      expect(remainingBuffer).toBe('');
    });
  });

  describe('parseSSEDataLine', () => {
    it('should parse a text event', () => {
      const line = 'data: {"event":"text","content":"Hello","message_id":"msg-123"}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'text',
        content: 'Hello',
        metadata: {
          session_id: undefined,
          message_id: 'msg-123',
        },
      });
    });

    it('should parse message_start event as status', () => {
      const line = 'data: {"event":"message_start","message_id":"msg-123","session_id":"sess-456"}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'status',
        content: 'started',
        metadata: {
          session_id: 'sess-456',
          message_id: 'msg-123',
        },
      });
    });

    it('should parse done event as status', () => {
      const line = 'data: {"event":"done","message_id":"msg-123","reason":"stop"}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'status',
        content: 'done',
        metadata: {
          session_id: undefined,
          message_id: 'msg-123',
          reason: 'stop',
        },
      });
    });

    it('should parse tool_executing event', () => {
      const line = 'data: {"event":"tool_executing","call_id":"call-1","tool":"read","input":{"path":"test.txt"}}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'tool_call',
        content: {
          id: 'call-1',
          name: 'read',
          arguments: { path: 'test.txt' },
        },
        metadata: {
          session_id: undefined,
          message_id: undefined,
        },
      });
    });

    it('should parse tool_result event', () => {
      const line = 'data: {"event":"tool_result","call_id":"call-1","output":"file content"}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'tool_result',
        content: {
          toolCallId: 'call-1',
          output: 'file content',
        },
        metadata: {
          session_id: undefined,
          message_id: undefined,
        },
      });
    });

    it('should parse tool_error event', () => {
      const line = 'data: {"event":"tool_error","call_id":"call-1","error":"File not found"}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'tool_result',
        content: {
          toolCallId: 'call-1',
          output: '',
          error: 'File not found',
        },
        metadata: {
          session_id: undefined,
          message_id: undefined,
        },
      });
    });

    it('should parse error event', () => {
      const line = 'data: {"event":"error","message":"Something went wrong"}';
      const result = parseSSEDataLine(line);

      expect(result).toEqual({
        type: 'error',
        content: 'Something went wrong',
        metadata: {
          session_id: undefined,
          message_id: undefined,
        },
      });
    });

    it('should return null for non-data lines', () => {
      expect(parseSSEDataLine('event: message')).toBeNull();
      expect(parseSSEDataLine('id: 123')).toBeNull();
      expect(parseSSEDataLine(': comment')).toBeNull();
      expect(parseSSEDataLine('retry: 1000')).toBeNull();
    });

    it('should return null for empty data', () => {
      expect(parseSSEDataLine('data: ')).toBeNull();
      expect(parseSSEDataLine('data:   ')).toBeNull();
    });

    it('should return null for [DONE] signal', () => {
      expect(parseSSEDataLine('data: [DONE]')).toBeNull();
    });

    it('should throw for invalid JSON', () => {
      expect(() => parseSSEDataLine('data: {invalid json}')).toThrow();
    });

    it('should return null for unknown event types', () => {
      const line = 'data: {"event":"unknown_event","data":"test"}';
      const result = parseSSEDataLine(line);
      expect(result).toBeNull();
    });
  });

  describe('createAgentApi', () => {
    let client: TalorClient;
    let agentApi: AgentApi;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TalorClient({ baseUrl: 'http://localhost:8000' });
      agentApi = createAgentApi(client);
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /**
     * Helper to create a mock ReadableStream from SSE data
     */
    function createMockSSEStream(events: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      let index = 0;

      return new ReadableStream({
        pull(controller) {
          if (index < events.length) {
            controller.enqueue(encoder.encode(events[index]));
            index++;
          } else {
            controller.close();
          }
        },
      });
    }

    it('should process SSE streaming response', async () => {
      const sseEvents = [
        'data: {"event":"message_start","message_id":"msg-123","session_id":"sess-456"}\n\n',
        'data: {"event":"text","content":"Hello","message_id":"msg-123"}\n\n',
        'data: {"event":"text","content":" World","message_id":"msg-123"}\n\n',
        'data: {"event":"done","message_id":"msg-123","reason":"stop"}\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockSSEStream(sseEvents),
      });

      const responses: AgentResponse[] = [];
      for await (const response of agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      })) {
        responses.push(response);
      }

      expect(responses).toHaveLength(4);
      expect(responses[0].type).toBe('status');
      expect(responses[0].content).toBe('started');
      expect(responses[1].type).toBe('text');
      expect(responses[1].content).toBe('Hello');
      expect(responses[2].type).toBe('text');
      expect(responses[2].content).toBe(' World');
      expect(responses[3].type).toBe('status');
      expect(responses[3].content).toBe('done');
    });

    it('should include model parameter when provided', async () => {
      const sseEvents = [
        'data: {"event":"done","message_id":"msg-123","reason":"stop"}\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockSSEStream(sseEvents),
      });

      const responses: AgentResponse[] = [];
      for await (const response of agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
        model: 'openai/gpt-4',
      })) {
        responses.push(response);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/session/prompt',
        expect.objectContaining({
          body: expect.stringContaining('"model":{"provider_id":"openai","model_id":"gpt-4"}'),
        })
      );
    });

    it('should handle HTTP 500 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const generator = agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      });

      await expect(generator.next()).rejects.toThrow('HTTP 500');
    });

    it('should handle HTTP 404 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Session not found'),
      });

      const generator = agentApi.processPrompt({
        sessionId: 'nonexistent',
        prompt: 'Hello',
      });

      await expect(generator.next()).rejects.toThrow('HTTP 404');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const generator = agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      });

      await expect(generator.next()).rejects.toThrow('Failed to fetch');
    });

    it('should handle null response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      });

      const generator = agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      });

      await expect(generator.next()).rejects.toThrow('Response body is null');
    });

    it('should send request to correct endpoint', async () => {
      const sseEvents = [
        'data: {"event":"done","message_id":"msg-123","reason":"stop"}\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockSSEStream(sseEvents),
      });

      const responses: AgentResponse[] = [];
      for await (const response of agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      })) {
        responses.push(response);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/session/prompt',
        expect.any(Object)
      );
    });

    it('should set correct headers for SSE', async () => {
      const sseEvents = [
        'data: {"event":"done","message_id":"msg-123","reason":"stop"}\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockSSEStream(sseEvents),
      });

      const responses: AgentResponse[] = [];
      for await (const response of agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      })) {
        responses.push(response);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          }),
        })
      );
    });

    it('should handle tool execution events', async () => {
      const sseEvents = [
        'data: {"event":"message_start","message_id":"msg-123"}\n\n',
        'data: {"event":"tool_executing","call_id":"call-1","tool":"read","input":{"path":"test.txt"},"message_id":"msg-123"}\n\n',
        'data: {"event":"tool_result","call_id":"call-1","output":"file content","message_id":"msg-123"}\n\n',
        'data: {"event":"done","message_id":"msg-123","reason":"stop"}\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockSSEStream(sseEvents),
      });

      const responses: AgentResponse[] = [];
      for await (const response of agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Read test.txt',
      })) {
        responses.push(response);
      }

      expect(responses).toHaveLength(4);
      expect(responses[1].type).toBe('tool_call');
      expect(responses[1].content).toEqual({
        id: 'call-1',
        name: 'read',
        arguments: { path: 'test.txt' },
      });
      expect(responses[2].type).toBe('tool_result');
      expect(responses[2].content).toEqual({
        toolCallId: 'call-1',
        output: 'file content',
      });
    });

    it('should handle error events in stream', async () => {
      const sseEvents = [
        'data: {"event":"message_start","message_id":"msg-123"}\n\n',
        'data: {"event":"error","message":"Provider error"}\n\n',
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockSSEStream(sseEvents),
      });

      const responses: AgentResponse[] = [];
      for await (const response of agentApi.processPrompt({
        sessionId: 'test-session',
        prompt: 'Hello',
      })) {
        responses.push(response);
      }

      expect(responses).toHaveLength(2);
      expect(responses[1].type).toBe('error');
      expect(responses[1].content).toBe('Provider error');
    });
  });

  describe('Agent list and get', () => {
    let client: TalorClient;
    let agentApi: AgentApi;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TalorClient({ baseUrl: 'http://localhost:8000' });
      agentApi = createAgentApi(client);
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should list agents', async () => {
      const mockAgents = [
        { name: 'build', description: 'Build agent', mode: 'auto', native: true, hidden: false },
        { name: 'chat', description: 'Chat agent', mode: 'manual', native: true, hidden: false },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockAgents),
      });

      const agents = await agentApi.list();

      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('build');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/agents',
        expect.any(Object)
      );
    });

    it('should get agent by name', async () => {
      const mockAgent = {
        name: 'build',
        description: 'Build agent',
        mode: 'auto',
        native: true,
        hidden: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockAgent),
      });

      const agent = await agentApi.get('build');

      expect(agent.name).toBe('build');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/agents/build',
        expect.any(Object)
      );
    });
  });
});
