/**
 * Session Store Tests
 * 会话 Store 测试
 *
 * Unit tests for the session store implementation.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 2.2 - 加载会话的消息历史
 * @requirements 2.3 - 删除会话并从列表中移除
 * @requirements 2.6 - 更新会话标题
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionStore, sortSessionsByUpdatedAt } from './session';
import type { Session, SessionInfo } from '../types/session';
import type { Message } from '../types/message';
import type { SessionApi } from '../api/session';
import type { AgentApi } from '../api/agent';
import type { AgentResponse } from '../types/api';

/**
 * Creates a mock SessionApi
 * 创建模拟的 SessionApi
 */
function createMockSessionApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    getMessages: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates a mock AgentApi
 * 创建模拟的 AgentApi
 */
function createMockAgentApi(overrides: Partial<AgentApi> = {}): AgentApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ name: 'test', description: null, mode: 'auto', native: true, hidden: false }),
    processPrompt: vi.fn(),
    processPromptAsync: vi.fn().mockResolvedValue({ status: 'processing', session_id: 'test', message_id: 'msg-1' }),
    ...overrides,
  };
}

/**
 * Creates a mock session
 * 创建模拟的会话
 */
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

/**
 * Creates a mock session info
 * 创建模拟的会话信息
 */
function createMockSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    title: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    ...overrides,
  };
}

/**
 * Creates a mock message
 * 创建模拟的消息
 */
function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Test message',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('Session Store', () => {
  beforeEach(() => {
    // Reset the store before each test
    useSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: {},
      isLoading: false,
      error: null,
      _sessionApi: null,
      _agentApi: null,
    });
  });

  describe('sortSessionsByUpdatedAt', () => {
    it('should sort sessions by updatedAt in descending order', () => {
      const sessions: SessionInfo[] = [
        createMockSessionInfo({ id: '1', updatedAt: 1000 }),
        createMockSessionInfo({ id: '2', updatedAt: 3000 }),
        createMockSessionInfo({ id: '3', updatedAt: 2000 }),
      ];

      const sorted = sortSessionsByUpdatedAt(sessions);

      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    it('should handle empty array', () => {
      const sorted = sortSessionsByUpdatedAt([]);
      expect(sorted).toEqual([]);
    });

    it('should handle single item array', () => {
      const sessions = [createMockSessionInfo({ id: '1' })];
      const sorted = sortSessionsByUpdatedAt(sessions);
      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe('1');
    });

    it('should not mutate the original array', () => {
      const sessions: SessionInfo[] = [
        createMockSessionInfo({ id: '1', updatedAt: 1000 }),
        createMockSessionInfo({ id: '2', updatedAt: 3000 }),
      ];
      const original = [...sessions];

      sortSessionsByUpdatedAt(sessions);

      expect(sessions[0].id).toBe(original[0].id);
      expect(sessions[1].id).toBe(original[1].id);
    });
  });

  describe('setApis', () => {
    it('should set the API instances', () => {
      const sessionApi = createMockSessionApi();
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);

      const state = useSessionStore.getState();
      expect(state._sessionApi).toBe(sessionApi);
      expect(state._agentApi).toBe(agentApi);
    });
  });

  describe('fetchSessions', () => {
    it('should fetch and sort sessions', async () => {
      const sessions: SessionInfo[] = [
        createMockSessionInfo({ id: '1', updatedAt: 1000 }),
        createMockSessionInfo({ id: '2', updatedAt: 3000 }),
        createMockSessionInfo({ id: '3', updatedAt: 2000 }),
      ];

      const sessionApi = createMockSessionApi({
        list: vi.fn().mockResolvedValue(sessions),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().fetchSessions();

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(3);
      expect(state.sessions[0].id).toBe('2');
      expect(state.sessions[1].id).toBe('3');
      expect(state.sessions[2].id).toBe('1');
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set error when API is not initialized', async () => {
      await useSessionStore.getState().fetchSessions();

      const state = useSessionStore.getState();
      expect(state.error).toBe('Session API not initialized');
    });

    it('should set error on API failure', async () => {
      const sessionApi = createMockSessionApi({
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);

      await expect(useSessionStore.getState().fetchSessions()).rejects.toThrow('Network error');

      const state = useSessionStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });

    it('should set isLoading during fetch', async () => {
      let resolveList: (value: SessionInfo[]) => void;
      const listPromise = new Promise<SessionInfo[]>((resolve) => {
        resolveList = resolve;
      });

      const sessionApi = createMockSessionApi({
        list: vi.fn().mockReturnValue(listPromise),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);

      const fetchPromise = useSessionStore.getState().fetchSessions();

      // Check loading state
      expect(useSessionStore.getState().isLoading).toBe(true);

      // Resolve the promise
      resolveList!([]);
      await fetchPromise;

      expect(useSessionStore.getState().isLoading).toBe(false);
    });
  });

  describe('createSession', () => {
    it('should create a session and update state', async () => {
      const newSession = createMockSession({ id: 'new-session' });

      const sessionApi = createMockSessionApi({
        create: vi.fn().mockResolvedValue(newSession),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      const result = await useSessionStore.getState().createSession();

      expect(result).toEqual(newSession);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('new-session');
      expect(state.currentSessionId).toBe('new-session');
      expect(state.messages['new-session']).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it('should add new session to existing list and sort', async () => {
      const existingSession = createMockSessionInfo({ id: 'existing', updatedAt: 1000 });
      useSessionStore.setState({ sessions: [existingSession] });

      const newSession = createMockSession({ id: 'new-session', updatedAt: 2000 });

      const sessionApi = createMockSessionApi({
        create: vi.fn().mockResolvedValue(newSession),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().createSession();

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.sessions[0].id).toBe('new-session'); // Newer session first
      expect(state.sessions[1].id).toBe('existing');
    });

    it('should throw error when API is not initialized', async () => {
      await expect(useSessionStore.getState().createSession()).rejects.toThrow(
        'Session API not initialized'
      );

      const state = useSessionStore.getState();
      expect(state.error).toBe('Session API not initialized');
    });

    it('should set error on API failure', async () => {
      const sessionApi = createMockSessionApi({
        create: vi.fn().mockRejectedValue(new Error('Create failed')),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);

      await expect(useSessionStore.getState().createSession()).rejects.toThrow('Create failed');

      const state = useSessionStore.getState();
      expect(state.error).toBe('Create failed');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('selectSession', () => {
    it('should select session and load messages', async () => {
      const messages: Message[] = [
        createMockMessage({ id: 'msg-1', sessionId: 'session-1' }),
        createMockMessage({ id: 'msg-2', sessionId: 'session-1' }),
      ];

      const sessionApi = createMockSessionApi({
        getMessages: vi.fn().mockResolvedValue(messages),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().selectSession('session-1');

      const state = useSessionStore.getState();
      expect(state.currentSessionId).toBe('session-1');
      expect(state.messages['session-1']).toEqual(messages);
      expect(state.isLoading).toBe(false);
    });

    it('should not fetch messages if already loaded', async () => {
      const existingMessages: Message[] = [createMockMessage({ sessionId: 'session-1' })];
      useSessionStore.setState({
        messages: { 'session-1': existingMessages },
      });

      const sessionApi = createMockSessionApi({
        getMessages: vi.fn(),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().selectSession('session-1');

      expect(sessionApi.getMessages).not.toHaveBeenCalled();

      const state = useSessionStore.getState();
      expect(state.currentSessionId).toBe('session-1');
      expect(state.messages['session-1']).toEqual(existingMessages);
    });

    it('should set error when API is not initialized', async () => {
      await useSessionStore.getState().selectSession('session-1');

      const state = useSessionStore.getState();
      expect(state.error).toBe('Session API not initialized');
    });

    it('should set error on API failure', async () => {
      const sessionApi = createMockSessionApi({
        getMessages: vi.fn().mockRejectedValue(new Error('Load failed')),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);

      await expect(useSessionStore.getState().selectSession('session-1')).rejects.toThrow(
        'Load failed'
      );

      const state = useSessionStore.getState();
      expect(state.error).toBe('Load failed');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('should delete session and update state', async () => {
      const sessions: SessionInfo[] = [
        createMockSessionInfo({ id: 'session-1' }),
        createMockSessionInfo({ id: 'session-2' }),
      ];
      useSessionStore.setState({
        sessions,
        messages: {
          'session-1': [createMockMessage({ sessionId: 'session-1' })],
          'session-2': [createMockMessage({ sessionId: 'session-2' })],
        },
      });

      const sessionApi = createMockSessionApi({
        delete: vi.fn().mockResolvedValue(undefined),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().deleteSession('session-1');

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('session-2');
      expect(state.messages['session-1']).toBeUndefined();
      expect(state.messages['session-2']).toBeDefined();
      expect(state.isLoading).toBe(false);
    });

    it('should clear currentSessionId if deleted session was selected', async () => {
      useSessionStore.setState({
        sessions: [createMockSessionInfo({ id: 'session-1' })],
        currentSessionId: 'session-1',
      });

      const sessionApi = createMockSessionApi({
        delete: vi.fn().mockResolvedValue(undefined),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().deleteSession('session-1');

      const state = useSessionStore.getState();
      expect(state.currentSessionId).toBeNull();
    });

    it('should not clear currentSessionId if different session was deleted', async () => {
      useSessionStore.setState({
        sessions: [
          createMockSessionInfo({ id: 'session-1' }),
          createMockSessionInfo({ id: 'session-2' }),
        ],
        currentSessionId: 'session-2',
      });

      const sessionApi = createMockSessionApi({
        delete: vi.fn().mockResolvedValue(undefined),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().deleteSession('session-1');

      const state = useSessionStore.getState();
      expect(state.currentSessionId).toBe('session-2');
    });

    it('should set error when API is not initialized', async () => {
      await useSessionStore.getState().deleteSession('session-1');

      const state = useSessionStore.getState();
      expect(state.error).toBe('Session API not initialized');
    });

    it('should set error on API failure', async () => {
      const sessionApi = createMockSessionApi({
        delete: vi.fn().mockRejectedValue(new Error('Delete failed')),
      });
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);

      await expect(useSessionStore.getState().deleteSession('session-1')).rejects.toThrow(
        'Delete failed'
      );

      const state = useSessionStore.getState();
      expect(state.error).toBe('Delete failed');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should send message and handle streaming response', async () => {
      useSessionStore.setState({
        currentSessionId: 'session-1',
        sessions: [createMockSessionInfo({ id: 'session-1' })],
        messages: { 'session-1': [] },
      });

      // Create async generator for streaming response
      async function* mockProcessPrompt(): AsyncGenerator<AgentResponse> {
        yield { type: 'text', content: 'Hello ' };
        yield { type: 'text', content: 'World!' };
      }

      const sessionApi = createMockSessionApi();
      const agentApi = createMockAgentApi({
        processPrompt: vi.fn().mockReturnValue(mockProcessPrompt()),
      });

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().sendMessage('Test prompt');

      const state = useSessionStore.getState();
      const messages = state.messages['session-1'];

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Test prompt');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Hello World!');
      expect(state.isLoading).toBe(false);
    });

    it('should handle tool calls in response', async () => {
      useSessionStore.setState({
        currentSessionId: 'session-1',
        sessions: [createMockSessionInfo({ id: 'session-1' })],
        messages: { 'session-1': [] },
      });

      async function* mockProcessPrompt(): AsyncGenerator<AgentResponse> {
        yield { type: 'text', content: 'Let me help you.' };
        yield {
          type: 'tool_call',
          content: { id: 'call-1', name: 'search', arguments: { query: 'test' } },
        };
        yield {
          type: 'tool_result',
          content: { toolCallId: 'call-1', output: 'Found results' },
        };
      }

      const sessionApi = createMockSessionApi();
      const agentApi = createMockAgentApi({
        processPrompt: vi.fn().mockReturnValue(mockProcessPrompt()),
      });

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().sendMessage('Search for test');

      const state = useSessionStore.getState();
      const assistantMessage = state.messages['session-1'][1];

      expect(assistantMessage.toolCalls).toHaveLength(1);
      expect(assistantMessage.toolCalls![0].name).toBe('search');
      expect(assistantMessage.toolResults).toHaveLength(1);
      expect(assistantMessage.toolResults![0].output).toBe('Found results');
    });

    it('should handle error response', async () => {
      useSessionStore.setState({
        currentSessionId: 'session-1',
        sessions: [createMockSessionInfo({ id: 'session-1' })],
        messages: { 'session-1': [] },
      });

      async function* mockProcessPrompt(): AsyncGenerator<AgentResponse> {
        yield { type: 'text', content: 'Processing...' };
        yield { type: 'error', content: 'Something went wrong' };
      }

      const sessionApi = createMockSessionApi();
      const agentApi = createMockAgentApi({
        processPrompt: vi.fn().mockReturnValue(mockProcessPrompt()),
      });

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().sendMessage('Test');

      const state = useSessionStore.getState();
      const assistantMessage = state.messages['session-1'][1];

      expect(assistantMessage.content).toContain('Processing...');
      expect(assistantMessage.content).toContain('错误: Something went wrong');
    });

    it('should set error when no session is selected', async () => {
      const sessionApi = createMockSessionApi();
      const agentApi = createMockAgentApi();

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().sendMessage('Test');

      const state = useSessionStore.getState();
      expect(state.error).toBe('没有选中的会话');
    });

    it('should set error when APIs are not initialized', async () => {
      useSessionStore.setState({ currentSessionId: 'session-1' });

      await useSessionStore.getState().sendMessage('Test');

      const state = useSessionStore.getState();
      expect(state.error).toBe('APIs not initialized');
    });

    it('should update session updatedAt and messageCount after sending', async () => {
      const originalUpdatedAt = 1000;
      useSessionStore.setState({
        currentSessionId: 'session-1',
        sessions: [
          createMockSessionInfo({ id: 'session-1', updatedAt: originalUpdatedAt, messageCount: 0 }),
        ],
        messages: { 'session-1': [] },
      });

      async function* mockProcessPrompt(): AsyncGenerator<AgentResponse> {
        yield { type: 'text', content: 'Response' };
      }

      const sessionApi = createMockSessionApi();
      const agentApi = createMockAgentApi({
        processPrompt: vi.fn().mockReturnValue(mockProcessPrompt()),
      });

      useSessionStore.getState().setApis(sessionApi, agentApi);
      await useSessionStore.getState().sendMessage('Test');

      const state = useSessionStore.getState();
      expect(state.sessions[0].updatedAt).toBeGreaterThan(originalUpdatedAt);
      expect(state.sessions[0].messageCount).toBe(2); // User + Assistant
    });
  });

  describe('addMessage', () => {
    it('should add message to existing session', () => {
      useSessionStore.setState({
        messages: { 'session-1': [createMockMessage({ id: 'msg-1', sessionId: 'session-1' })] },
      });

      const newMessage = createMockMessage({ id: 'msg-2', sessionId: 'session-1' });
      useSessionStore.getState().addMessage(newMessage);

      const state = useSessionStore.getState();
      expect(state.messages['session-1']).toHaveLength(2);
      expect(state.messages['session-1'][1].id).toBe('msg-2');
    });

    it('should create new session messages array if not exists', () => {
      useSessionStore.setState({ messages: {} });

      const newMessage = createMockMessage({ id: 'msg-1', sessionId: 'new-session' });
      useSessionStore.getState().addMessage(newMessage);

      const state = useSessionStore.getState();
      expect(state.messages['new-session']).toHaveLength(1);
      expect(state.messages['new-session'][0].id).toBe('msg-1');
    });
  });

  describe('updateMessage', () => {
    it('should update message content', () => {
      useSessionStore.setState({
        messages: {
          'session-1': [createMockMessage({ id: 'msg-1', sessionId: 'session-1', content: 'Old' })],
        },
      });

      useSessionStore.getState().updateMessage('msg-1', { content: 'New' });

      const state = useSessionStore.getState();
      expect(state.messages['session-1'][0].content).toBe('New');
    });

    it('should update message across multiple sessions', () => {
      useSessionStore.setState({
        messages: {
          'session-1': [createMockMessage({ id: 'msg-1', sessionId: 'session-1' })],
          'session-2': [createMockMessage({ id: 'msg-2', sessionId: 'session-2' })],
        },
      });

      useSessionStore.getState().updateMessage('msg-2', { content: 'Updated' });

      const state = useSessionStore.getState();
      expect(state.messages['session-1'][0].content).toBe('Test message');
      expect(state.messages['session-2'][0].content).toBe('Updated');
    });

    it('should not modify other messages', () => {
      useSessionStore.setState({
        messages: {
          'session-1': [
            createMockMessage({ id: 'msg-1', sessionId: 'session-1', content: 'First' }),
            createMockMessage({ id: 'msg-2', sessionId: 'session-1', content: 'Second' }),
          ],
        },
      });

      useSessionStore.getState().updateMessage('msg-1', { content: 'Updated' });

      const state = useSessionStore.getState();
      expect(state.messages['session-1'][0].content).toBe('Updated');
      expect(state.messages['session-1'][1].content).toBe('Second');
    });
  });

  describe('clearError', () => {
    it('should clear the error state', () => {
      useSessionStore.setState({ error: 'Some error' });

      useSessionStore.getState().clearError();

      const state = useSessionStore.getState();
      expect(state.error).toBeNull();
    });
  });

  describe('addSession', () => {
    it('should add a new session to the list', () => {
      useSessionStore.setState({ sessions: [] });

      const newSession = createMockSessionInfo({ id: 'new-session', title: 'New Session' });
      useSessionStore.getState().addSession(newSession);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('new-session');
      expect(state.sessions[0].title).toBe('New Session');
    });

    it('should add session to existing list and sort by updatedAt', () => {
      const oldSession = createMockSessionInfo({
        id: 'old-session',
        updatedAt: Date.now() - 10000,
      });
      useSessionStore.setState({ sessions: [oldSession] });

      const newSession = createMockSessionInfo({
        id: 'new-session',
        updatedAt: Date.now(),
      });
      useSessionStore.getState().addSession(newSession);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.sessions[0].id).toBe('new-session'); // Newer session first
      expect(state.sessions[1].id).toBe('old-session');
    });

    it('should not add duplicate session', () => {
      const existingSession = createMockSessionInfo({ id: 'session-1' });
      useSessionStore.setState({ sessions: [existingSession] });

      const duplicateSession = createMockSessionInfo({ id: 'session-1', title: 'Duplicate' });
      useSessionStore.getState().addSession(duplicateSession);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].title).toBe('Test Session'); // Original title preserved
    });

    it('should initialize empty messages array for new session', () => {
      useSessionStore.setState({ sessions: [], messages: {} });

      const newSession = createMockSessionInfo({ id: 'new-session' });
      useSessionStore.getState().addSession(newSession);

      const state = useSessionStore.getState();
      expect(state.messages['new-session']).toEqual([]);
    });

    it('should preserve existing messages for session', () => {
      const existingMessages = [createMockMessage({ id: 'msg-1', sessionId: 'session-1' })];
      useSessionStore.setState({
        sessions: [],
        messages: { 'session-1': existingMessages },
      });

      const newSession = createMockSessionInfo({ id: 'session-1' });
      useSessionStore.getState().addSession(newSession);

      const state = useSessionStore.getState();
      expect(state.messages['session-1']).toEqual(existingMessages);
    });
  });

  describe('updateSession', () => {
    it('should update session title', () => {
      const session = createMockSessionInfo({ id: 'session-1', title: 'Old Title' });
      useSessionStore.setState({ sessions: [session] });

      useSessionStore.getState().updateSession('session-1', { title: 'New Title' });

      const state = useSessionStore.getState();
      expect(state.sessions[0].title).toBe('New Title');
    });

    it('should update session updatedAt', () => {
      const oldUpdatedAt = Date.now() - 10000;
      const session = createMockSessionInfo({ id: 'session-1', updatedAt: oldUpdatedAt });
      useSessionStore.setState({ sessions: [session] });

      const newUpdatedAt = Date.now();
      useSessionStore.getState().updateSession('session-1', { updatedAt: newUpdatedAt });

      const state = useSessionStore.getState();
      expect(state.sessions[0].updatedAt).toBe(newUpdatedAt);
    });

    it('should re-sort sessions after update', () => {
      const session1 = createMockSessionInfo({ id: 'session-1', updatedAt: Date.now() });
      const session2 = createMockSessionInfo({ id: 'session-2', updatedAt: Date.now() - 10000 });
      useSessionStore.setState({ sessions: [session1, session2] });

      // Update session2 to be more recent
      useSessionStore.getState().updateSession('session-2', { updatedAt: Date.now() + 1000 });

      const state = useSessionStore.getState();
      expect(state.sessions[0].id).toBe('session-2'); // Now first due to newer updatedAt
      expect(state.sessions[1].id).toBe('session-1');
    });

    it('should not modify other sessions', () => {
      const session1 = createMockSessionInfo({ id: 'session-1', title: 'Session 1' });
      const session2 = createMockSessionInfo({ id: 'session-2', title: 'Session 2' });
      useSessionStore.setState({ sessions: [session1, session2] });

      useSessionStore.getState().updateSession('session-1', { title: 'Updated' });

      const state = useSessionStore.getState();
      expect(state.sessions.find((s) => s.id === 'session-1')?.title).toBe('Updated');
      expect(state.sessions.find((s) => s.id === 'session-2')?.title).toBe('Session 2');
    });

    it('should handle updating non-existent session gracefully', () => {
      const session = createMockSessionInfo({ id: 'session-1' });
      useSessionStore.setState({ sessions: [session] });

      // This should not throw
      useSessionStore.getState().updateSession('non-existent', { title: 'New Title' });

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('session-1');
    });
  });

  describe('removeSession', () => {
    it('should remove session from list', () => {
      const session1 = createMockSessionInfo({ id: 'session-1' });
      const session2 = createMockSessionInfo({ id: 'session-2' });
      useSessionStore.setState({ sessions: [session1, session2] });

      useSessionStore.getState().removeSession('session-1');

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('session-2');
    });

    it('should remove messages for deleted session', () => {
      const session = createMockSessionInfo({ id: 'session-1' });
      const messages = [createMockMessage({ id: 'msg-1', sessionId: 'session-1' })];
      useSessionStore.setState({
        sessions: [session],
        messages: { 'session-1': messages },
      });

      useSessionStore.getState().removeSession('session-1');

      const state = useSessionStore.getState();
      expect(state.messages['session-1']).toBeUndefined();
    });

    it('should clear currentSessionId if removed session was selected', () => {
      const session = createMockSessionInfo({ id: 'session-1' });
      useSessionStore.setState({
        sessions: [session],
        currentSessionId: 'session-1',
      });

      useSessionStore.getState().removeSession('session-1');

      const state = useSessionStore.getState();
      expect(state.currentSessionId).toBeNull();
    });

    it('should not clear currentSessionId if different session was removed', () => {
      const session1 = createMockSessionInfo({ id: 'session-1' });
      const session2 = createMockSessionInfo({ id: 'session-2' });
      useSessionStore.setState({
        sessions: [session1, session2],
        currentSessionId: 'session-1',
      });

      useSessionStore.getState().removeSession('session-2');

      const state = useSessionStore.getState();
      expect(state.currentSessionId).toBe('session-1');
    });

    it('should handle removing non-existent session gracefully', () => {
      const session = createMockSessionInfo({ id: 'session-1' });
      useSessionStore.setState({ sessions: [session] });

      // This should not throw
      useSessionStore.getState().removeSession('non-existent');

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
    });

    it('should preserve messages for other sessions', () => {
      const session1 = createMockSessionInfo({ id: 'session-1' });
      const session2 = createMockSessionInfo({ id: 'session-2' });
      const messages1 = [createMockMessage({ id: 'msg-1', sessionId: 'session-1' })];
      const messages2 = [createMockMessage({ id: 'msg-2', sessionId: 'session-2' })];
      useSessionStore.setState({
        sessions: [session1, session2],
        messages: { 'session-1': messages1, 'session-2': messages2 },
      });

      useSessionStore.getState().removeSession('session-1');

      const state = useSessionStore.getState();
      expect(state.messages['session-2']).toEqual(messages2);
    });
  });
});
