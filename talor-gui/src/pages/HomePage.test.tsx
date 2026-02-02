/**
 * HomePage Component Tests
 * 主页面组件测试
 *
 * Tests for the HomePage component that integrates session list
 * and chat view functionality.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { HomePage } from './HomePage';
import { useSessionStore } from '../store/session';
import type { SessionInfo } from '../types/session';
import type { Message } from '../types/message';

// Mock the session store
vi.mock('../store/session', () => ({
  useSessionStore: vi.fn(),
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock scrollIntoView for jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * Test wrapper component with providers
 * 带有 providers 的测试包装组件
 */
const TestWrapper: React.FC<{
  children: React.ReactNode;
  initialEntries?: string[];
}> = ({ children, initialEntries = ['/'] }) => (
  <I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={children} />
        <Route path="/session/:sessionId" element={children} />
      </Routes>
    </MemoryRouter>
  </I18nextProvider>
);

/**
 * Create mock session store state
 * 创建模拟的会话 store 状态
 */
const createMockStore = (overrides = {}) => ({
  sessions: [] as SessionInfo[],
  currentSessionId: null as string | null,
  messages: {} as Record<string, Message[]>,
  isLoading: false,
  error: null as string | null,
  fetchSessions: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue({ id: 'new-session', title: 'New Session', createdAt: Date.now(), updatedAt: Date.now(), metadata: {} }),
  selectSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  addMessage: vi.fn(),
  updateMessage: vi.fn(),
  clearError: vi.fn(),
  setApis: vi.fn(),
  ...overrides,
});

describe('HomePage', () => {
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    mockStore = createMockStore();
    vi.mocked(useSessionStore).mockReturnValue(mockStore as any);
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the home page container', () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });

    it('should render the sidebar with session list', () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByTestId('home-sidebar')).toBeInTheDocument();
    });

    it('should render the main content area', () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByTestId('home-main-content')).toBeInTheDocument();
    });

    it('should render welcome state when no session is selected', () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByTestId('home-welcome-state')).toBeInTheDocument();
      expect(screen.getByTestId('home-create-session-button')).toBeInTheDocument();
    });
  });

  describe('Session List Integration', () => {
    it('should display sessions in the session list', () => {
      const sessions: SessionInfo[] = [
        {
          id: 'session-1',
          title: 'Test Session 1',
          createdAt: Date.now() - 3600000,
          updatedAt: Date.now(),
          messageCount: 5,
        },
        {
          id: 'session-2',
          title: 'Test Session 2',
          createdAt: Date.now() - 7200000,
          updatedAt: Date.now() - 1800000,
          messageCount: 3,
        },
      ];

      mockStore = createMockStore({ sessions });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByText('Test Session 1')).toBeInTheDocument();
      expect(screen.getByText('Test Session 2')).toBeInTheDocument();
    });

    it('should fetch sessions on mount', () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(mockStore.fetchSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Session Creation', () => {
    it('should create a new session when clicking the create button', async () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      const createButton = screen.getByTestId('home-create-session-button');
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockStore.createSession).toHaveBeenCalledTimes(1);
      });
    });

    it('should navigate to the new session after creation', async () => {
      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      const createButton = screen.getByTestId('home-create-session-button');
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/session/new-session');
      });
    });

    it('should disable create button when loading', () => {
      mockStore = createMockStore({ isLoading: true });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      const createButton = screen.getByTestId('home-create-session-button');
      expect(createButton).toBeDisabled();
    });
  });

  describe('Session Selection', () => {
    it('should select session when clicking on a session item', async () => {
      const sessions: SessionInfo[] = [
        {
          id: 'session-1',
          title: 'Test Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
      ];

      mockStore = createMockStore({ sessions });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      const sessionItem = screen.getByText('Test Session');
      fireEvent.click(sessionItem);

      await waitFor(() => {
        expect(mockStore.selectSession).toHaveBeenCalledWith('session-1');
      });
    });

    it('should navigate to session URL after selection', async () => {
      const sessions: SessionInfo[] = [
        {
          id: 'session-1',
          title: 'Test Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
      ];

      mockStore = createMockStore({ sessions });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      const sessionItem = screen.getByText('Test Session');
      fireEvent.click(sessionItem);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/session/session-1');
      });
    });
  });

  describe('Chat View Integration', () => {
    it('should display chat view when a session is selected', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Hi there!',
          createdAt: Date.now(),
        },
      ];

      mockStore = createMockStore({
        currentSessionId: 'session-1',
        messages: { 'session-1': messages },
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-1']}>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByTestId('chat-view')).toBeInTheDocument();
      expect(screen.getByTestId('prompt-input-container')).toBeInTheDocument();
    });

    it('should display messages in the chat view', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello world',
          createdAt: Date.now(),
        },
      ];

      mockStore = createMockStore({
        currentSessionId: 'session-1',
        messages: { 'session-1': messages },
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-1']}>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });

  describe('Message Sending', () => {
    it('should send message when submitting the prompt input', async () => {
      mockStore = createMockStore({
        currentSessionId: 'session-1',
        messages: { 'session-1': [] },
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-1']}>
          <HomePage />
        </TestWrapper>
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.change(textarea, { target: { value: 'Test message' } });

      const sendButton = screen.getByTestId('prompt-input-send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockStore.sendMessage).toHaveBeenCalledWith('Test message');
      });
    });

    it('should clear input after sending message', async () => {
      mockStore = createMockStore({
        currentSessionId: 'session-1',
        messages: { 'session-1': [] },
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-1']}>
          <HomePage />
        </TestWrapper>
      );

      const textarea = screen.getByTestId('prompt-input-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Test message' } });

      const sendButton = screen.getByTestId('prompt-input-send-button');
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(textarea.value).toBe('');
      });
    });

    it('should disable input when loading', () => {
      mockStore = createMockStore({
        currentSessionId: 'session-1',
        messages: { 'session-1': [] },
        isLoading: true,
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-1']}>
          <HomePage />
        </TestWrapper>
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toBeDisabled();
    });
  });

  describe('Session Deletion', () => {
    it('should delete session when delete is confirmed', async () => {
      const sessions: SessionInfo[] = [
        {
          id: 'session-1',
          title: 'Test Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
      ];

      mockStore = createMockStore({ sessions });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      // Find and click the delete button (in SessionItem)
      const deleteButton = screen.getByLabelText(/delete/i);
      fireEvent.click(deleteButton);

      // Now click the confirm button
      const confirmButton = screen.getByLabelText(/confirm/i);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
      });
    });

    it('should navigate to home when current session is deleted', async () => {
      const sessions: SessionInfo[] = [
        {
          id: 'session-1',
          title: 'Test Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
      ];

      mockStore = createMockStore({
        sessions,
        currentSessionId: 'session-1',
        messages: { 'session-1': [] },
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-1']}>
          <HomePage />
        </TestWrapper>
      );

      // Find and click the delete button
      const deleteButton = screen.getByLabelText(/delete/i);
      fireEvent.click(deleteButton);

      // Now click the confirm button
      const confirmButton = screen.getByLabelText(/confirm/i);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error state when there is an error', () => {
      mockStore = createMockStore({
        error: 'Failed to load sessions',
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      expect(screen.getByTestId('home-error-state')).toBeInTheDocument();
      expect(screen.getByText('Failed to load sessions')).toBeInTheDocument();
    });

    it('should clear error when close button is clicked', () => {
      mockStore = createMockStore({
        error: 'Failed to load sessions',
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockStore.clearError).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL Synchronization', () => {
    it('should sync session from URL on mount', async () => {
      mockStore = createMockStore({
        sessions: [
          {
            id: 'session-from-url',
            title: 'URL Session',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
          },
        ],
      });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/session-from-url']}>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockStore.selectSession).toHaveBeenCalledWith('session-from-url');
      });
    });

    it('should navigate to home if URL session is not found', async () => {
      mockStore = createMockStore();
      mockStore.selectSession = vi.fn().mockRejectedValue(new Error('Session not found'));
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper initialEntries={['/session/non-existent']}>
          <HomePage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading state in session list', () => {
      mockStore = createMockStore({ isLoading: true });
      vi.mocked(useSessionStore).mockReturnValue(mockStore as any);

      render(
        <TestWrapper>
          <HomePage />
        </TestWrapper>
      );

      // The SessionList component handles its own loading state
      expect(screen.getByTestId('home-sidebar')).toBeInTheDocument();
    });
  });
});
