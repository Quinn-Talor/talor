/**
 * Agent API Module
 * 代理 API 模块
 *
 * Provides agent-related API calls for the Talor GUI client,
 * including streaming prompt processing using Server-Sent Events (SSE).
 * Updated to match the new OpenCode-compatible backend API.
 * 为 Talor GUI 客户端提供代理相关的 API 调用，
 * 包括使用服务器发送事件 (SSE) 的流式提示词处理。
 * 已更新以匹配新的 OpenCode 兼容后端 API。
 *
 * @requirements 3.5 - 流式输出显示
 */

import type { TalorClient } from './client';
import type { AgentResponse, ProcessPromptParams } from '../types/api';
import { NetworkError } from './client';

/**
 * SSE data prefix
 * SSE 数据前缀
 */
const SSE_DATA_PREFIX = 'data: ';

/**
 * Agent info from backend
 * 后端返回的代理信息
 */
export interface AgentInfo {
  name: string;
  description: string | null;
  mode: string;
  native: boolean;
  hidden: boolean;
}

/**
 * SSE Event from backend streaming
 * 后端流式返回的 SSE 事件
 */
export interface SSEStreamEvent {
  event: string;
  content?: string;
  message?: string;
  message_id?: string;
  session_id?: string;
  call_id?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  reason?: string;
  tool_call?: {
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  };
}

/**
 * Agent API interface
 * 代理 API 接口
 *
 * Defines all agent-related API operations.
 */
export interface AgentApi {
  /**
   * Lists all available agents
   * 列出所有可用的代理
   *
   * @returns Array of agent info / 代理信息数组
   */
  list(): Promise<AgentInfo[]>;

  /**
   * Gets an agent by name
   * 根据名称获取代理
   *
   * @param name - The agent name / 代理名称
   * @returns Agent info / 代理信息
   */
  get(name: string): Promise<AgentInfo>;

  /**
   * Processes a prompt and returns a streaming response (方案 A)
   * 处理提示词并返回流式响应（方案 A）
   *
   * @param params - Process prompt parameters / 处理提示词参数
   * @returns AsyncGenerator yielding AgentResponse objects / 产生 AgentResponse 对象的异步生成器
   */
  processPrompt(params: ProcessPromptParams): AsyncGenerator<AgentResponse, void, unknown>;

  /**
   * Processes a prompt asynchronously (方案 B)
   * 异步处理提示词（方案 B）
   *
   * Sends the prompt and returns immediately. Results are delivered via the /event SSE stream.
   * 发送提示词并立即返回。结果通过 /event SSE 流传递。
   *
   * @param params - Process prompt parameters / 处理提示词参数
   * @returns Promise with status and message ID / 包含状态和消息 ID 的 Promise
   */
  processPromptAsync(params: ProcessPromptParams): Promise<{ status: string; session_id: string; message_id: string }>;
}

/**
 * Parses SSE lines from a chunk of text
 * 从文本块中解析 SSE 行
 *
 * Handles partial lines that may span multiple chunks by maintaining
 * a buffer of incomplete data.
 *
 * @param chunk - The text chunk to parse / 要解析的文本块
 * @param buffer - Buffer containing incomplete line from previous chunk / 包含上一块不完整行的缓冲区
 * @returns Object containing parsed lines and remaining buffer / 包含解析行和剩余缓冲区的对象
 */
export function parseSSEChunk(
  chunk: string,
  buffer: string
): { lines: string[]; remainingBuffer: string } {
  // Combine buffer with new chunk
  const combined = buffer + chunk;

  // Split by newlines, keeping track of incomplete lines
  const parts = combined.split('\n');

  // The last part might be incomplete (no trailing newline)
  const remainingBuffer = parts.pop() ?? '';

  // Filter out empty lines and return
  const lines = parts.filter((line) => line.trim().length > 0);

  return { lines, remainingBuffer };
}

/**
 * Parses an SSE data line into an AgentResponse
 * 将 SSE 数据行解析为 AgentResponse
 *
 * @param line - The SSE line to parse / 要解析的 SSE 行
 * @returns Parsed AgentResponse or null if not a data line / 解析的 AgentResponse 或如果不是数据行则为 null
 * @throws Error if JSON parsing fails / 如果 JSON 解析失败则抛出错误
 */
export function parseSSEDataLine(line: string): AgentResponse | null {
  // Skip event lines and other non-data lines
  if (!line.startsWith(SSE_DATA_PREFIX)) {
    return null;
  }

  // Extract the JSON data after "data: "
  const jsonStr = line.slice(SSE_DATA_PREFIX.length).trim();

  // Handle empty data
  if (!jsonStr) {
    return null;
  }

  // Handle SSE keep-alive or end signals
  if (jsonStr === '[DONE]') {
    return null;
  }

  // Parse the JSON data
  const data = JSON.parse(jsonStr) as SSEStreamEvent;

  // Convert SSE event to AgentResponse
  return convertSSEToAgentResponse(data);
}

/**
 * Converts SSE stream event to AgentResponse
 * 将 SSE 流事件转换为 AgentResponse
 */
function convertSSEToAgentResponse(event: SSEStreamEvent): AgentResponse | null {
  const metadata = {
    session_id: event.session_id,
    message_id: event.message_id,
  };

  switch (event.event) {
    case 'text':
      return {
        type: 'text',
        content: event.content ?? '',
        metadata,
      };

    case 'message_start':
      return {
        type: 'status',
        content: 'started',
        metadata,
      };

    case 'tool_call':
      if (event.tool_call) {
        return {
          type: 'tool_call',
          content: {
            id: event.tool_call.id,
            name: event.tool_call.function.name,
            arguments: JSON.parse(event.tool_call.function.arguments || '{}'),
          },
          metadata,
        };
      }
      return null;

    case 'tool_executing':
      return {
        type: 'tool_call',
        content: {
          id: event.call_id ?? '',
          name: event.tool ?? '',
          arguments: event.input ?? {},
        },
        metadata,
      };

    case 'tool_result':
      return {
        type: 'tool_result',
        content: {
          toolCallId: event.call_id ?? '',
          output: event.output ?? '',
        },
        metadata,
      };

    case 'tool_error':
      return {
        type: 'tool_result',
        content: {
          toolCallId: event.call_id ?? '',
          output: '',
          error: event.error,
        },
        metadata,
      };

    case 'error':
      return {
        type: 'error',
        content: event.message ?? event.error ?? 'Unknown error',
        metadata,
      };

    case 'done':
      return {
        type: 'status',
        content: 'done',
        metadata: {
          ...metadata,
          reason: event.reason,
        },
      };

    default:
      return null;
  }
}

/**
 * Backend prompt request body
 * 后端 prompt 请求体
 */
interface BackendPromptRequest {
  session_id: string;
  parts: Array<{
    type: string;
    text?: string;
  }>;
  model?: {
    provider_id: string;
    model_id: string;
  };
  agent?: string;
  no_reply?: boolean;
}

/**
 * Creates an agent API instance bound to a TalorClient
 * 创建绑定到 TalorClient 的代理 API 实例
 *
 * @param client - The TalorClient instance / TalorClient 实例
 * @returns Agent API object / 代理 API 对象
 */
export function createAgentApi(client: TalorClient): AgentApi {
  return {
    /**
     * Lists all available agents
     * 列出所有可用的代理
     *
     * GET /api/agents
     *
     * @returns Array of agent info / 代理信息数组
     */
    async list(): Promise<AgentInfo[]> {
      return client.get<AgentInfo[]>('/api/agents');
    },

    /**
     * Gets an agent by name
     * 根据名称获取代理
     *
     * GET /api/agents/:name
     *
     * @param name - The agent name / 代理名称
     * @returns Agent info / 代理信息
     */
    async get(name: string): Promise<AgentInfo> {
      return client.get<AgentInfo>(`/api/agents/${encodeURIComponent(name)}`);
    },

    /**
     * Processes a prompt and returns a streaming response via SSE
     * 通过 SSE 处理提示词并返回流式响应
     *
     * POST /api/session/prompt
     *
     * This method sends a prompt to the backend and yields AgentResponse
     * objects as they stream in via Server-Sent Events.
     *
     * @param params - Process prompt parameters / 处理提示词参数
     * @yields AgentResponse objects as they are received / 接收到的 AgentResponse 对象
     */
    async *processPrompt(params: ProcessPromptParams): AsyncGenerator<AgentResponse, void, unknown> {
      const { sessionId, prompt, model, agent } = params;

      // Build request body in new format
      const body: BackendPromptRequest = {
        session_id: sessionId,
        parts: [{ type: 'text', text: prompt }],
      };

      // Add model if specified
      if (model !== undefined) {
        // Parse model string like "openai/gpt-4" into provider and model
        const [provider, modelName] = model.includes('/')
          ? model.split('/', 2)
          : ['ollama', model];
        body.model = { provider_id: provider, model_id: modelName };
      }

      // Add agent if specified
      if (agent !== undefined) {
        body.agent = agent;
      }

      try {
        // Use fetch with streaming for SSE
        const response = await fetch(`${client.getBaseUrl()}/api/session/prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new NetworkError(`HTTP ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new NetworkError('Response body is null');
        }

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Decode the chunk
          const chunk = decoder.decode(value, { stream: true });
          const { lines, remainingBuffer } = parseSSEChunk(chunk, buffer);
          buffer = remainingBuffer;

          // Process each line
          for (const line of lines) {
            try {
              const agentResponse = parseSSEDataLine(line);
              if (agentResponse) {
                yield agentResponse;

                // Check if done
                if (agentResponse.type === 'status' && agentResponse.content === 'done') {
                  return;
                }
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE line:', line, parseError);
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const agentResponse = parseSSEDataLine(buffer);
            if (agentResponse) {
              yield agentResponse;
            }
          } catch {
            // Ignore parse errors for incomplete data
          }
        }
      } catch (error) {
        // Handle errors
        if (error instanceof NetworkError) {
          throw error;
        }

        if (error instanceof Error) {
          throw new NetworkError(error.message);
        }

        throw new NetworkError('未知错误');
      }
    },
    /**
     * Processes a prompt asynchronously (方案 B)
     * 异步处理提示词（方案 B）
     *
     * POST /api/session/prompt/async
     *
     * Sends the prompt and returns immediately. Results are delivered via the /event SSE stream.
     *
     * @param params - Process prompt parameters / 处理提示词参数
     * @returns Promise with status and message ID / 包含状态和消息 ID 的 Promise
     */
    async processPromptAsync(params: ProcessPromptParams): Promise<{ status: string; session_id: string; message_id: string }> {
      const { sessionId, prompt, model, agent } = params;

      // Build request body
      const body: BackendPromptRequest = {
        session_id: sessionId,
        parts: [{ type: 'text', text: prompt }],
      };

      // Add model if specified
      if (model !== undefined) {
        const [provider, modelName] = model.includes('/')
          ? model.split('/', 2)
          : ['ollama', model];
        body.model = { provider_id: provider, model_id: modelName };
      }

      // Add agent if specified
      if (agent !== undefined) {
        body.agent = agent;
      }

      // Use the async endpoint
      return client.post<{ status: string; session_id: string; message_id: string }>(
        '/api/session/prompt/async',
        body
      );
    },
  };
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default createAgentApi;
