/**
 * Session State Store
 * 会话状态 Store
 *
 * Manages session state using Zustand, including session list,
 * current session, messages, and related actions.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 2.2 - 加载会话的消息历史
 * @requirements 2.3 - 删除会话并从列表中移除
 * @requirements 2.6 - 更新会话标题
 */

import { create } from 'zustand';
import type { AgentApi } from '../api/agent';
import type { EventsApi } from '../api/events';
import type { SessionApi } from '../api/session';
import type { Message } from '../types/message';
import type { Session, SessionInfo } from '../types/session';

/**
 * Session state interface
 * 会话状态接口
 */
export interface SessionState {
  /** List of all sessions / 所有会话列表 */
  sessions: SessionInfo[];
  /** Currently selected session ID / 当前选中的会话 ID */
  currentSessionId: string | null;
  /** Messages indexed by session ID / 按会话 ID 索引的消息 */
  messages: Record<string, Message[]>;
  /** Loading state indicator / 加载状态指示器 */
  isLoading: boolean;
  /** Error message if any / 错误信息（如果有） */
  error: string | null;
}

/**
 * Session actions interface
 * 会话操作接口
 */
export interface SessionActions {
  /**
   * Fetches all sessions from the backend
   * 从后端获取所有会话
   */
  fetchSessions(): Promise<void>;

  /**
   * Creates a new session and switches to it
   * 创建新会话并切换到该会话
   *
   * @returns The created session / 创建的会话
   */
  createSession(): Promise<Session>;

  /**
   * Selects a session and loads its messages
   * 选择会话并加载其消息
   *
   * @param sessionId - The session ID to select / 要选择的会话 ID
   */
  selectSession(sessionId: string): Promise<void>;

  /**
   * Deletes a session
   * 删除会话
   *
   * @param sessionId - The session ID to delete / 要删除的会话 ID
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Sends a message in the current session (方案 A - 流式响应)
   * 在当前会话中发送消息（方案 A - 流式响应）
   *
   * @param content - The message content / 消息内容
   */
  sendMessage(content: string): Promise<void>;

  /**
   * Sends a message using async mode (方案 B - 分离式)
   * 使用异步模式发送消息（方案 B - 分离式）
   *
   * @param content - The message content / 消息内容
   */
  sendMessageAsync(content: string): Promise<void>;

  /**
   * Adds a message to a session
   * 向会话添加消息
   *
   * @param message - The message to add / 要添加的消息
   */
  addMessage(message: Message): void;

  /**
   * Updates an existing message
   * 更新现有消息
   *
   * @param messageId - The message ID to update / 要更新的消息 ID
   * @param updates - Partial message updates / 部分消息更新
   */
  updateMessage(messageId: string, updates: Partial<Message>): void;

  /**
   * Adds a session to the session list (from event)
   * 添加会话到会话列表（来自事件）
   *
   * @param session - The session info to add / 要添加的会话信息
   */
  addSession(session: SessionInfo): void;

  /**
   * Updates an existing session in the list
   * 更新会话列表中的现有会话
   *
   * @param sessionId - The session ID to update / 要更新的会话 ID
   * @param updates - Partial session updates / 部分会话更新
   */
  updateSession(sessionId: string, updates: Partial<SessionInfo>): void;

  /**
   * Removes a session from the list (local only, no API call)
   * 从列表中移除会话（仅本地，不调用 API）
   *
   * @param sessionId - The session ID to remove / 要移除的会话 ID
   */
  removeSession(sessionId: string): void;

  /**
   * Appends streaming text to a message (方案 B)
   * 向消息追加流式文本（方案 B）
   *
   * @param sessionId - The session ID / 会话 ID
   * @param messageId - The message ID / 消息 ID
   * @param content - The text content to append / 要追加的文本内容
   */
  appendStreamingText(sessionId: string, messageId: string, content: string): void;

  /**
   * Adds a tool call to a message (方案 B)
   * 向消息添加工具调用（方案 B）
   *
   * @param sessionId - The session ID / 会话 ID
   * @param messageId - The message ID / 消息 ID
   * @param toolCall - The tool call data / 工具调用数据
   */
  addToolCall(sessionId: string, messageId: string, toolCall: { id: string; name: string; arguments: Record<string, unknown> }): void;

  /**
   * Adds a tool result to a message (方案 B)
   * 向消息添加工具结果（方案 B）
   *
   * @param sessionId - The session ID / 会话 ID
   * @param messageId - The message ID / 消息 ID
   * @param toolResult - The tool result data / 工具结果数据
   */
  addToolResult(sessionId: string, messageId: string, toolResult: { toolCallId: string; output: string; error?: string }): void;

  /**
   * Sets the loading state
   * 设置加载状态
   *
   * @param loading - The loading state / 加载状态
   */
  setLoading(loading: boolean): void;

  /**
   * Sets the error state
   * 设置错误状态
   *
   * @param error - The error message or null / 错误信息或 null
   */
  setError(error: string | null): void;

  /**
   * Clears the error state
   * 清除错误状态
   */
  clearError(): void;

  /**
   * Sets the API instances for the store
   * 设置 store 的 API 实例
   *
   * @param sessionApi - Session API instance / 会话 API 实例
   * @param agentApi - Agent API instance / 代理 API 实例
   * @param eventsApi - Events API instance (optional) / 事件 API 实例（可选）
   */
  setApis(sessionApi: SessionApi, agentApi: AgentApi, eventsApi?: EventsApi): void;
}

/**
 * Combined session store type
 * 组合的会话 store 类型
 */
export type SessionStore = SessionState & SessionActions;

/**
 * Internal store state with API references
 * 带有 API 引用的内部 store 状态
 */
interface InternalState {
  _sessionApi: SessionApi | null;
  _agentApi: AgentApi | null;
  _eventsApi: EventsApi | null;
}

/**
 * Initial state for the session store
 * 会话 store 的初始状态
 */
const initialState: SessionState = {
  sessions: [],
  currentSessionId: null,
  messages: {},
  isLoading: false,
  error: null,
};

/**
 * Sorts sessions by updatedAt in descending order
 * 按 updatedAt 降序排序会话
 *
 * @param sessions - Sessions to sort / 要排序的会话
 * @returns Sorted sessions / 排序后的会话
 */
export function sortSessionsByUpdatedAt<T extends { updatedAt: number }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Generates a unique message ID
 * 生成唯一的消息 ID
 *
 * @returns Unique message ID / 唯一的消息 ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates the session store
 * 创建会话 store
 */
export const useSessionStore = create<SessionStore & InternalState>((set, get) => ({
  // Initial state
  ...initialState,

  // Internal API references
  _sessionApi: null,
  _agentApi: null,
  _eventsApi: null,

  /**
   * Sets the API instances for the store
   * 设置 store 的 API 实例
   */
  setApis(sessionApi: SessionApi, agentApi: AgentApi, eventsApi?: EventsApi): void {
    set({ _sessionApi: sessionApi, _agentApi: agentApi, _eventsApi: eventsApi ?? null });
  },

  /**
   * Fetches all sessions from the backend
   * 从后端获取所有会话
   *
   * @requirements 2.4 - 显示所有会话的标题、创建时间和最后更新时间
   * @requirements 2.5 - 按最后更新时间降序排列
   */
  async fetchSessions(): Promise<void> {
    const { _sessionApi } = get();
    if (!_sessionApi) {
      set({ error: 'Session API not initialized' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const sessions = await _sessionApi.list();
      // Sort sessions by updatedAt in descending order
      const sortedSessions = sortSessionsByUpdatedAt(sessions);
      set({ sessions: sortedSessions, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '获取会话列表失败';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  /**
   * Creates a new session and switches to it
   * 创建新会话并切换到该会话
   *
   * @requirements 2.1 - 创建新会话并切换到该会话
   */
  async createSession(): Promise<Session> {
    const { _sessionApi } = get();
    if (!_sessionApi) {
      const error = new Error('Session API not initialized');
      set({ error: error.message });
      throw error;
    }

    set({ isLoading: true, error: null });

    try {
      const session = await _sessionApi.create();

      // Convert Session to SessionInfo for the list
      const sessionInfo: SessionInfo = {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: 0,
      };

      set((state) => {
        // Add new session to the list and sort
        const updatedSessions = sortSessionsByUpdatedAt([sessionInfo, ...state.sessions]);
        return {
          sessions: updatedSessions,
          currentSessionId: session.id,
          messages: {
            ...state.messages,
            [session.id]: [],
          },
          isLoading: false,
        };
      });

      return session;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建会话失败';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  /**
   * Selects a session and loads its messages
   * 选择会话并加载其消息
   *
   * @requirements 2.2 - 加载该会话的消息历史
   */
  async selectSession(sessionId: string): Promise<void> {
    const { _sessionApi, messages, currentSessionId } = get();
    if (!_sessionApi) {
      set({ error: 'Session API not initialized' });
      return;
    }

    // Skip if already selected
    if (sessionId === currentSessionId) {
      return;
    }

    set({ currentSessionId: sessionId, isLoading: true, error: null });

    try {
      // Only fetch messages if not already loaded
      if (!messages[sessionId]) {
        const sessionMessages = await _sessionApi.getMessages(sessionId);
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: sessionMessages,
          },
          isLoading: false,
        }));
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '加载会话消息失败';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  /**
   * Deletes a session
   * 删除会话
   *
   * @requirements 2.3 - 确认删除并从列表中移除该会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const { _sessionApi, currentSessionId } = get();
    if (!_sessionApi) {
      set({ error: 'Session API not initialized' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      await _sessionApi.delete(sessionId);

      set((state) => {
        // Remove session from list
        const updatedSessions = state.sessions.filter((s) => s.id !== sessionId);

        // Remove messages for the deleted session
        const { [sessionId]: _, ...remainingMessages } = state.messages;

        // Clear currentSessionId if the deleted session was selected
        const newCurrentSessionId =
          currentSessionId === sessionId ? null : state.currentSessionId;

        return {
          sessions: updatedSessions,
          messages: remainingMessages,
          currentSessionId: newCurrentSessionId,
          isLoading: false,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '删除会话失败';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  /**
   * Sends a message in the current session
   * 在当前会话中发送消息
   *
   * Uses the streaming prompt endpoint (方案 A).
   * This method handles the response directly via SSE streaming.
   *
   * 使用流式 prompt 端点（方案 A）。
   * 此方法通过 SSE 流式直接处理响应。
   */
  async sendMessage(content: string): Promise<void> {
    const { _sessionApi, _agentApi, currentSessionId } = get();

    if (!_sessionApi || !_agentApi) {
      set({ error: 'APIs not initialized' });
      return;
    }

    if (!currentSessionId) {
      set({ error: '没有选中的会话' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Create user message with local_ prefix for deduplication
      const userMessage: Message = {
        id: `local_${generateMessageId()}`,
        sessionId: currentSessionId,
        role: 'user',
        content,
        createdAt: Date.now(),
      };

      // Add user message to state
      get().addMessage(userMessage);

      // Create placeholder assistant message for streaming
      const assistantMessageId = `local_${generateMessageId()}`;
      const assistantMessage: Message = {
        id: assistantMessageId,
        sessionId: currentSessionId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };

      // Add placeholder assistant message
      get().addMessage(assistantMessage);

      // Process the prompt with streaming
      // Note: This uses the SSE streaming endpoint (方案 A)
      // For 方案 B (async + /event), use processPromptAsync instead
      let accumulatedContent = '';
      const toolCalls: Message['toolCalls'] = [];
      const toolResults: Message['toolResults'] = [];

      for await (const response of _agentApi.processPrompt({
        sessionId: currentSessionId,
        prompt: content,
      })) {
        switch (response.type) {
          case 'text':
            // Accumulate text content
            accumulatedContent +=
              typeof response.content === 'string' ? response.content : '';
            get().updateMessage(assistantMessageId, { content: accumulatedContent });
            break;

          case 'status':
            // Handle status events (started, done)
            // These are informational and don't need state updates
            if (response.content === 'done') {
              // Streaming complete
              break;
            }
            break;

          case 'tool_call':
            // Add tool call
            if (typeof response.content === 'object' && response.content !== null) {
              const toolCall = response.content as {
                id?: string;
                name?: string;
                arguments?: Record<string, unknown>;
              };
              if (toolCall.id && toolCall.name) {
                toolCalls.push({
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.arguments ?? {},
                });
                get().updateMessage(assistantMessageId, { toolCalls: [...toolCalls] });
              }
            }
            break;

          case 'tool_result':
            // Add tool result
            if (typeof response.content === 'object' && response.content !== null) {
              const toolResult = response.content as {
                toolCallId?: string;
                output?: string;
                error?: string;
              };
              if (toolResult.toolCallId) {
                toolResults.push({
                  toolCallId: toolResult.toolCallId,
                  output: toolResult.output ?? '',
                  error: toolResult.error,
                });
                get().updateMessage(assistantMessageId, { toolResults: [...toolResults] });
              }
            }
            break;

          case 'error':
            // Handle error response
            const errorContent =
              typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);
            get().updateMessage(assistantMessageId, {
              content: accumulatedContent + `\n\n错误: ${errorContent}`,
            });
            break;
        }
      }

      // Update session in the list (updatedAt changed)
      set((state) => {
        const updatedSessions = state.sessions.map((s) =>
          s.id === currentSessionId
            ? { ...s, updatedAt: Date.now(), messageCount: s.messageCount + 2 }
            : s
        );
        return {
          sessions: sortSessionsByUpdatedAt(updatedSessions),
          isLoading: false,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '发送消息失败';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  /**
   * Sends a message using async mode (方案 B)
   * 使用异步模式发送消息（方案 B）
   *
   * This method sends the prompt asynchronously and relies on the /event SSE
   * stream to receive responses. This is more resilient to network issues.
   *
   * 此方法异步发送 prompt，依赖 /event SSE 流接收响应。对网络问题更有弹性。
   *
   * Uses optimistic update: adds user message locally first, then deduplicates
   * when the backend event arrives.
   * 使用乐观更新：先在本地添加用户消息，然后在后端事件到达时去重。
   */
  async sendMessageAsync(content: string): Promise<void> {
    const { _sessionApi, _agentApi, currentSessionId } = get();

    console.debug('[SessionStore] sendMessageAsync called:', {
      hasSessionApi: !!_sessionApi,
      hasAgentApi: !!_agentApi,
      currentSessionId,
      contentLength: content.length,
    });

    if (!_sessionApi || !_agentApi) {
      console.error('[SessionStore] APIs not initialized');
      set({ error: 'APIs not initialized' });
      return;
    }

    if (!currentSessionId) {
      console.error('[SessionStore] No session selected');
      set({ error: '没有选中的会话' });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Create user message with optimistic update
      // Use a special prefix to identify locally-created messages
      const userMessage: Message = {
        id: `local_${generateMessageId()}`,
        sessionId: currentSessionId,
        role: 'user',
        content,
        createdAt: Date.now(),
      };

      // Add user message to state (optimistic update)
      get().addMessage(userMessage);
      console.debug('[SessionStore] Added local user message:', userMessage.id);

      // Send prompt asynchronously - response will come via /event SSE stream
      // The useEvents hook will handle message.created events
      // When the backend event arrives, addMessage will deduplicate by content
      console.debug('[SessionStore] Calling processPromptAsync...');
      const result = await _agentApi.processPromptAsync({
        sessionId: currentSessionId,
        prompt: content,
      });
      console.debug('[SessionStore] processPromptAsync result:', result);

      // Note: isLoading will be set to false when we receive the done event
      // via the /event SSE stream (handled by useEvents hook)
    } catch (error) {
      console.error('[SessionStore] sendMessageAsync error:', error);
      const errorMessage = error instanceof Error ? error.message : '发送消息失败';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  /**
   * Adds a message to a session
   * 向会话添加消息
   *
   * Handles deduplication for optimistic updates:
   * - If a message with the same ID exists, skip it
   * - If a local message (id starts with 'local_') with same role and content exists,
   *   replace it with the backend message (which has the real ID)
   *
   * 处理乐观更新的去重：
   * - 如果存在相同 ID 的消息，跳过
   * - 如果存在相同角色和内容的本地消息（ID 以 'local_' 开头），
   *   用后端消息（具有真实 ID）替换它
   */
  addMessage(message: Message): void {
    set((state) => {
      const sessionMessages = state.messages[message.sessionId] ?? [];

      // Check if message already exists by ID
      const existsById = sessionMessages.some((m) => m.id === message.id);
      if (existsById) {
        return state;
      }

      // Check if this is a backend message that should replace a local optimistic message
      // Local messages have IDs starting with 'local_'
      if (!message.id.startsWith('local_')) {
        // Find a local message with same role and content
        const localMessageIndex = sessionMessages.findIndex(
          (m) => m.id.startsWith('local_') && m.role === message.role && m.content === message.content
        );

        if (localMessageIndex !== -1) {
          // Replace the local message with the backend message
          const updatedMessages = [...sessionMessages];
          updatedMessages[localMessageIndex] = message;
          return {
            messages: {
              ...state.messages,
              [message.sessionId]: updatedMessages,
            },
          };
        }
      }

      return {
        messages: {
          ...state.messages,
          [message.sessionId]: [...sessionMessages, message],
        },
      };
    });
  },

  /**
   * Updates an existing message
   * 更新现有消息
   */
  updateMessage(messageId: string, updates: Partial<Message>): void {
    set((state) => {
      const newMessages: Record<string, Message[]> = {};

      for (const [sessionId, sessionMessages] of Object.entries(state.messages)) {
        newMessages[sessionId] = sessionMessages.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        );
      }

      return { messages: newMessages };
    });
  },

  /**
   * Adds a session to the session list (from event)
   * 添加会话到会话列表（来自事件）
   *
   * This method is used when receiving session.created events from the backend.
   * It adds the session to the list and sorts by updatedAt.
   */
  addSession(session: SessionInfo): void {
    set((state) => {
      // Check if session already exists
      const exists = state.sessions.some((s) => s.id === session.id);
      if (exists) {
        return state;
      }

      // Add new session and sort
      const updatedSessions = sortSessionsByUpdatedAt([session, ...state.sessions]);
      return {
        sessions: updatedSessions,
        messages: {
          ...state.messages,
          [session.id]: state.messages[session.id] ?? [],
        },
      };
    });
  },

  /**
   * Updates an existing session in the list
   * 更新会话列表中的现有会话
   *
   * This method is used when receiving session.updated events from the backend.
   */
  updateSession(sessionId: string, updates: Partial<SessionInfo>): void {
    set((state) => {
      const updatedSessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      );
      return {
        sessions: sortSessionsByUpdatedAt(updatedSessions),
      };
    });
  },

  /**
   * Removes a session from the list (local only, no API call)
   * 从列表中移除会话（仅本地，不调用 API）
   *
   * This method is used when receiving session.deleted events from the backend.
   * Unlike deleteSession, this does not make an API call.
   */
  removeSession(sessionId: string): void {
    console.debug('[SessionStore] removeSession called:', sessionId);

    set((state) => {
      // Remove session from list
      const updatedSessions = state.sessions.filter((s) => s.id !== sessionId);

      // Remove messages for the deleted session
      const { [sessionId]: _, ...remainingMessages } = state.messages;

      // Clear currentSessionId if the deleted session was selected
      const newCurrentSessionId =
        state.currentSessionId === sessionId ? null : state.currentSessionId;

      console.debug('[SessionStore] removeSession result:', {
        removedSessionId: sessionId,
        wasCurrentSession: state.currentSessionId === sessionId,
        newCurrentSessionId,
        remainingSessions: updatedSessions.length,
      });

      return {
        sessions: updatedSessions,
        messages: remainingMessages,
        currentSessionId: newCurrentSessionId,
      };
    });
  },

  /**
   * Appends streaming text to a message (方案 B)
   * 向消息追加流式文本（方案 B）
   *
   * This method is called when receiving stream.text events from the /event SSE stream.
   * It finds the message by ID and appends the content to it.
   */
  appendStreamingText(sessionId: string, messageId: string, content: string): void {
    set((state) => {
      const sessionMessages = state.messages[sessionId];
      if (!sessionMessages) {
        // Session not found, create a new assistant message
        return {
          messages: {
            ...state.messages,
            [sessionId]: [{
              id: messageId,
              sessionId,
              role: 'assistant' as const,
              content,
              createdAt: Date.now(),
            }],
          },
        };
      }

      // Find the message
      const messageIndex = sessionMessages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) {
        // Message not found, create a new one
        return {
          messages: {
            ...state.messages,
            [sessionId]: [
              ...sessionMessages,
              {
                id: messageId,
                sessionId,
                role: 'assistant' as const,
                content,
                createdAt: Date.now(),
              },
            ],
          },
        };
      }

      // Append content to existing message
      const updatedMessages = [...sessionMessages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        content: (updatedMessages[messageIndex].content || '') + content,
      };

      return {
        messages: {
          ...state.messages,
          [sessionId]: updatedMessages,
        },
      };
    });
  },

  /**
   * Adds a tool call to a message (方案 B)
   * 向消息添加工具调用（方案 B）
   */
  addToolCall(sessionId: string, messageId: string, toolCall: { id: string; name: string; arguments: Record<string, unknown> }): void {
    set((state) => {
      const sessionMessages = state.messages[sessionId];
      if (!sessionMessages) return state;

      const messageIndex = sessionMessages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = sessionMessages[messageIndex];
      const existingToolCalls = message.toolCalls || [];

      // Check if tool call already exists
      if (existingToolCalls.some((tc) => tc.id === toolCall.id)) {
        return state;
      }

      const updatedMessages = [...sessionMessages];
      updatedMessages[messageIndex] = {
        ...message,
        toolCalls: [...existingToolCalls, toolCall],
      };

      return {
        messages: {
          ...state.messages,
          [sessionId]: updatedMessages,
        },
      };
    });
  },

  /**
   * Adds a tool result to a message (方案 B)
   * 向消息添加工具结果（方案 B）
   */
  addToolResult(sessionId: string, messageId: string, toolResult: { toolCallId: string; output: string; error?: string }): void {
    set((state) => {
      const sessionMessages = state.messages[sessionId];
      if (!sessionMessages) return state;

      const messageIndex = sessionMessages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = sessionMessages[messageIndex];
      const existingToolResults = message.toolResults || [];

      // Check if tool result already exists
      if (existingToolResults.some((tr) => tr.toolCallId === toolResult.toolCallId)) {
        return state;
      }

      const updatedMessages = [...sessionMessages];
      updatedMessages[messageIndex] = {
        ...message,
        toolResults: [...existingToolResults, toolResult],
      };

      return {
        messages: {
          ...state.messages,
          [sessionId]: updatedMessages,
        },
      };
    });
  },

  /**
   * Sets the loading state
   * 设置加载状态
   */
  setLoading(loading: boolean): void {
    set({ isLoading: loading });
  },

  /**
   * Sets the error state
   * 设置错误状态
   */
  setError(error: string | null): void {
    set({ error, isLoading: false });
  },

  /**
   * Clears the error state
   * 清除错误状态
   */
  clearError(): void {
    set({ error: null });
  },
}));

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default useSessionStore;
