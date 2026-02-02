/**
 * Session API Module
 * 会话 API 模块
 *
 * Provides session management API calls for the Talor GUI client.
 * Updated to match the new OpenCode-compatible backend API.
 * 为 Talor GUI 客户端提供会话管理 API 调用。
 * 已更新以匹配新的 OpenCode 兼容后端 API。
 *
 * @requirements 2.1 - 创建新会话
 * @requirements 2.2 - 加载会话消息历史
 * @requirements 2.3 - 删除会话
 */

import type { TalorClient } from './client';
import type { Session, SessionInfo } from '../types/session';
import type { Message, MessageRole } from '../types/message';

/**
 * Request body for creating a new session
 * 创建新会话的请求体
 */
export interface CreateSessionRequest {
  /** Optional title for the session / 会话的可选标题 */
  title?: string;
  /** Optional parent session ID / 可选的父会话 ID */
  parent_id?: string;
}

/**
 * Query parameters for listing sessions
 * 获取会话列表的查询参数
 */
export interface ListSessionsParams {
  /** Maximum number of sessions to return / 返回的最大会话数量 */
  limit?: number;
}

/**
 * Query parameters for getting session messages
 * 获取会话消息的查询参数
 */
export interface GetMessagesParams {
  /** Maximum number of messages to return / 返回的最大消息数量 */
  limit?: number;
}

/**
 * Session API interface
 * 会话 API 接口
 *
 * Defines all session-related API operations.
 */
export interface SessionApi {
  /**
   * Creates a new session
   * 创建新会话
   *
   * @param title - Optional title for the session / 会话的可选标题
   * @returns The created session / 创建的会话
   */
  create(title?: string): Promise<Session>;

  /**
   * Gets a session by ID
   * 根据 ID 获取会话
   *
   * @param sessionId - The session ID / 会话 ID
   * @returns The session details / 会话详情
   */
  get(sessionId: string): Promise<Session>;

  /**
   * Lists all sessions
   * 获取所有会话列表
   *
   * @param limit - Maximum number of sessions to return / 返回的最大会话数量
   * @returns Array of session info / 会话信息数组
   */
  list(limit?: number): Promise<SessionInfo[]>;

  /**
   * Deletes a session
   * 删除会话
   *
   * @param sessionId - The session ID to delete / 要删除的会话 ID
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Gets messages for a session
   * 获取会话的消息
   *
   * @param sessionId - The session ID / 会话 ID
   * @param limit - Maximum number of messages to return / 返回的最大消息数量
   * @returns Array of messages / 消息数组
   */
  getMessages(sessionId: string, limit?: number): Promise<Message[]>;
}

/**
 * Backend session response (new OpenCode-compatible format)
 * 后端会话响应（新的 OpenCode 兼容格式）
 *
 * Uses `time` dict with `created` and `updated` timestamps instead of
 * `created_at` and `updated_at` strings.
 */
interface BackendSessionResponse {
  id: string;
  title: string;
  directory: string;
  parent_id: string | null;
  time: {
    created: number;
    updated: number;
  };
}

/**
 * Backend message part types
 * 后端消息部分类型
 */
interface BackendMessagePart {
  type: string;
  text?: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: string;
  tool_error?: string;
}

/**
 * Backend message response (new OpenCode-compatible format)
 * 后端消息响应（新的 OpenCode 兼容格式）
 */
interface BackendMessageResponse {
  info: {
    id: string;
    session_id: string;
    role: string;
    time: {
      created: number;
      updated: number;
    };
  };
  parts: BackendMessagePart[];
}

/**
 * Converts backend session response to frontend Session type
 * 将后端会话响应转换为前端 Session 类型
 */
function toSession(response: BackendSessionResponse): Session {
  return {
    id: response.id,
    title: response.title,
    createdAt: response.time.created,
    updatedAt: response.time.updated,
    metadata: {
      directory: response.directory,
      parentId: response.parent_id,
    },
  };
}

/**
 * Converts backend session response to frontend SessionInfo type
 * 将后端会话响应转换为前端 SessionInfo 类型
 */
function toSessionInfo(response: BackendSessionResponse): SessionInfo {
  return {
    id: response.id,
    title: response.title,
    createdAt: response.time.created,
    updatedAt: response.time.updated,
    messageCount: 0, // Backend doesn't provide this in list response
  };
}

/**
 * Converts backend message response to frontend Message type
 * 将后端消息响应转换为前端 Message 类型
 */
function toMessage(response: BackendMessageResponse): Message {
  // Extract text content from parts
  const textParts = response.parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text as string);
  const content = textParts.join('');

  // Extract tool calls from parts
  const toolCalls = response.parts
    .filter((p) => p.type === 'tool-invocation' && p.tool_call_id)
    .map((p) => ({
      id: p.tool_call_id as string,
      name: p.tool_name as string,
      arguments: p.tool_args ?? {},
    }));

  // Extract tool results from parts
  const toolResults = response.parts
    .filter((p) => p.type === 'tool-result' && p.tool_call_id)
    .map((p) => ({
      toolCallId: p.tool_call_id as string,
      output: p.tool_result ?? '',
      error: p.tool_error,
    }));

  return {
    id: response.info.id,
    sessionId: response.info.session_id,
    role: response.info.role as MessageRole,
    content,
    createdAt: response.info.time.created,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
  };
}

/**
 * Creates a session API instance bound to a TalorClient
 * 创建绑定到 TalorClient 的会话 API 实例
 *
 * @param client - The TalorClient instance / TalorClient 实例
 * @returns Session API object / 会话 API 对象
 */
export function createSessionApi(client: TalorClient): SessionApi {
  return {
    /**
     * Creates a new session
     * 创建新会话
     *
     * POST /api/sessions
     *
     * @param title - Optional title for the session / 会话的可选标题
     * @returns The created session / 创建的会话
     */
    async create(title?: string): Promise<Session> {
      const body: CreateSessionRequest = {};
      if (title) {
        body.title = title;
      }
      const response = await client.post<BackendSessionResponse>('/api/sessions', body);
      return toSession(response);
    },

    /**
     * Gets a session by ID
     * 根据 ID 获取会话
     *
     * GET /api/sessions/:id
     *
     * @param sessionId - The session ID / 会话 ID
     * @returns The session details / 会话详情
     */
    async get(sessionId: string): Promise<Session> {
      const response = await client.get<BackendSessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);
      return toSession(response);
    },

    /**
     * Lists all sessions
     * 获取所有会话列表
     *
     * GET /api/sessions
     *
     * @param limit - Maximum number of sessions to return / 返回的最大会话数量
     * @returns Array of session info / 会话信息数组
     */
    async list(limit?: number): Promise<SessionInfo[]> {
      let endpoint = '/api/sessions';
      if (limit !== undefined) {
        endpoint += `?limit=${encodeURIComponent(limit.toString())}`;
      }
      const response = await client.get<BackendSessionResponse[]>(endpoint);
      return response.map(toSessionInfo);
    },

    /**
     * Deletes a session
     * 删除会话
     *
     * DELETE /api/sessions/:id
     *
     * @param sessionId - The session ID to delete / 要删除的会话 ID
     */
    async delete(sessionId: string): Promise<void> {
      await client.delete<void>(`/api/sessions/${encodeURIComponent(sessionId)}`);
    },

    /**
     * Gets messages for a session
     * 获取会话的消息
     *
     * GET /api/sessions/:id/messages
     *
     * @param sessionId - The session ID / 会话 ID
     * @param limit - Maximum number of messages to return / 返回的最大消息数量
     * @returns Array of messages / 消息数组
     */
    async getMessages(sessionId: string, limit?: number): Promise<Message[]> {
      let endpoint = `/api/sessions/${encodeURIComponent(sessionId)}/messages`;
      if (limit !== undefined) {
        endpoint += `?limit=${encodeURIComponent(limit.toString())}`;
      }
      const response = await client.get<BackendMessageResponse[]>(endpoint);
      return response.map(toMessage);
    },
  };
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default createSessionApi;
