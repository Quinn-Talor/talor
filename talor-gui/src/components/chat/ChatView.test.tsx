/**
 * ChatView Component Tests
 * 聊天视图组件测试
 *
 * Tests for the ChatView component including message display,
 * auto-scroll functionality, empty state, and loading indicator.
 *
 * @requirements 3.6 - 支持消息的滚动浏览和自动滚动到最新消息
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { ChatView } from './ChatView';
import type { ChatViewProps } from './ChatView';
import type { Message } from '../../types/message';

/**
 * Create a mock message for testing
 * 创建用于测试的模拟消息
 */
function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).substr(2, 9)}`,
    sessionId: 'test-session',
    role: 'user',
    content: 'Test message content',
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Create multiple mock messages
 * 创建多个模拟消息
 */
function createMockMessages(count: number, sessionId = 'test-session'): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    sessionId,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}`,
    createdAt: Date.now() - (count - i) * 1000,
  })) as Message[];
}

/**
 * Default props for ChatView
 * ChatView 的默认属性
 */
const defaultProps: ChatViewProps = {
  sessionId: 'test-session',
  messages: [],
  isLoading: false,
  onSendMessage: vi.fn(),
  onRetry: vi.fn(),
};

/**
 * Render ChatView with i18n provider
 * 使用 i18n 提供者渲染 ChatView
 */
function renderChatView(props: Partial<ChatViewProps> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ChatView {...defaultProps} {...props} />
    </I18nextProvider>
  );
}

describe('ChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render the chat view container', () => {
      renderChatView();

      const chatView = screen.getByTestId('chat-view');
      expect(chatView).toBeInTheDocument();
    });

    it('should render with the correct session ID', () => {
      renderChatView({ sessionId: 'my-session-123' });

      const chatView = screen.getByTestId('chat-view');
      expect(chatView).toHaveAttribute('data-session-id', 'my-session-123');
    });

    it('should render the message list container', () => {
      renderChatView();

      const container = screen.getByTestId('message-list-container');
      expect(container).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when there are no messages', () => {
      renderChatView({ messages: [] });

      const emptyState = screen.getByTestId('chat-empty-state');
      expect(emptyState).toBeInTheDocument();
    });

    it('should display "No messages yet" text in empty state', () => {
      renderChatView({ messages: [] });

      expect(screen.getByText(/no messages/i)).toBeInTheDocument();
    });

    it('should display conversation prompt in empty state', () => {
      renderChatView({ messages: [] });

      expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
    });

    it('should not show empty state when there are messages', () => {
      const messages = [createMockMessage()];
      renderChatView({ messages });

      expect(screen.queryByTestId('chat-empty-state')).not.toBeInTheDocument();
    });
  });

  describe('Message Display', () => {
    it('should render all messages', () => {
      const messages = createMockMessages(3);
      renderChatView({ messages });

      const messageItems = screen.getAllByTestId('message-item');
      expect(messageItems).toHaveLength(3);
    });

    it('should render messages in order', () => {
      const messages = createMockMessages(3);
      renderChatView({ messages });

      const messageTexts = screen.getAllByTestId('message-text');
      expect(messageTexts[0]).toHaveTextContent('Message 1');
      expect(messageTexts[1]).toHaveTextContent('Message 2');
      expect(messageTexts[2]).toHaveTextContent('Message 3');
    });

    it('should pass isStreaming prop to the streaming message', () => {
      const messages = [
        createMockMessage({ id: 'msg-1', content: 'Hello' }),
        createMockMessage({ id: 'msg-2', role: 'assistant', content: 'Hi there' }),
      ];
      renderChatView({ messages, streamingMessageId: 'msg-2' });

      // The streaming indicator should be visible for the streaming message
      const streamingIndicator = screen.getByTestId('streaming-indicator');
      expect(streamingIndicator).toBeInTheDocument();
    });

    it('should not show streaming indicator when no message is streaming', () => {
      const messages = [
        createMockMessage({ id: 'msg-1', content: 'Hello' }),
        createMockMessage({ id: 'msg-2', role: 'assistant', content: 'Hi there' }),
      ];
      renderChatView({ messages });

      expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should show loading indicator when isLoading is true and no streaming message', () => {
      const messages = [createMockMessage()];
      renderChatView({ messages, isLoading: true });

      const loadingIndicator = screen.getByTestId('chat-loading-indicator');
      expect(loadingIndicator).toBeInTheDocument();
    });

    it('should display "Thinking..." text in loading indicator', () => {
      const messages = [createMockMessage()];
      renderChatView({ messages, isLoading: true });

      expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    });

    it('should not show loading indicator when isLoading is false', () => {
      const messages = [createMockMessage()];
      renderChatView({ messages, isLoading: false });

      expect(screen.queryByTestId('chat-loading-indicator')).not.toBeInTheDocument();
    });

    it('should not show loading indicator when there is a streaming message', () => {
      const messages = [
        createMockMessage({ id: 'msg-1', role: 'assistant', content: 'Streaming...' }),
      ];
      renderChatView({ messages, isLoading: true, streamingMessageId: 'msg-1' });

      expect(screen.queryByTestId('chat-loading-indicator')).not.toBeInTheDocument();
    });

    it('should not show empty state when loading with no messages', () => {
      renderChatView({ messages: [], isLoading: true });

      // When loading, we should show the loading indicator, not empty state
      // But based on our implementation, empty state is shown when messages.length === 0 && !isLoading
      // So when isLoading is true, empty state should not be shown
      expect(screen.queryByTestId('chat-empty-state')).not.toBeInTheDocument();
    });
  });

  describe('Scroll to Bottom Button', () => {
    it('should not show scroll button initially', () => {
      const messages = createMockMessages(5);
      renderChatView({ messages });

      expect(screen.queryByTestId('scroll-to-bottom-button')).not.toBeInTheDocument();
    });

    it('should show scroll button when user scrolls up', async () => {
      const messages = createMockMessages(20);
      renderChatView({ messages });

      const container = screen.getByTestId('message-list-container');

      // Mock scroll position to simulate scrolling up
      Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(container, 'clientHeight', { value: 400, writable: true });

      fireEvent.scroll(container);

      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-button')).toBeInTheDocument();
      });
    });

    it('should hide scroll button when near bottom', async () => {
      const messages = createMockMessages(20);
      renderChatView({ messages });

      const container = screen.getByTestId('message-list-container');

      // First scroll up to show the button
      Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(container, 'clientHeight', { value: 400, writable: true });

      fireEvent.scroll(container);

      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-button')).toBeInTheDocument();
      });

      // Then scroll to bottom
      Object.defineProperty(container, 'scrollTop', { value: 550, writable: true });

      fireEvent.scroll(container);

      await waitFor(() => {
        expect(screen.queryByTestId('scroll-to-bottom-button')).not.toBeInTheDocument();
      });
    });

    it('should scroll to bottom when button is clicked', async () => {
      const messages = createMockMessages(20);
      renderChatView({ messages });

      const container = screen.getByTestId('message-list-container');

      // Scroll up to show the button
      Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(container, 'clientHeight', { value: 400, writable: true });

      fireEvent.scroll(container);

      await waitFor(() => {
        expect(screen.getByTestId('scroll-to-bottom-button')).toBeInTheDocument();
      });

      const scrollButton = screen.getByTestId('scroll-to-bottom-button');
      fireEvent.click(scrollButton);

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('should have correct aria-label on scroll button', async () => {
      const messages = createMockMessages(20);
      renderChatView({ messages });

      const container = screen.getByTestId('message-list-container');

      Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(container, 'clientHeight', { value: 400, writable: true });

      fireEvent.scroll(container);

      await waitFor(() => {
        const scrollButton = screen.getByTestId('scroll-to-bottom-button');
        expect(scrollButton).toHaveAttribute('aria-label', 'Scroll to bottom');
      });
    });
  });

  describe('Auto-scroll Behavior', () => {
    it('should auto-scroll when new messages arrive', () => {
      const messages = createMockMessages(3);
      const { rerender } = renderChatView({ messages });

      // Add a new message
      const newMessages = [...messages, createMockMessage({ id: 'new-msg' })];
      rerender(
        <I18nextProvider i18n={i18n}>
          <ChatView {...defaultProps} messages={newMessages} />
        </I18nextProvider>
      );

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('should auto-scroll when session changes', () => {
      const messages = createMockMessages(3);
      const { rerender } = renderChatView({ messages, sessionId: 'session-1' });

      // Change session
      rerender(
        <I18nextProvider i18n={i18n}>
          <ChatView {...defaultProps} messages={messages} sessionId="session-2" />
        </I18nextProvider>
      );

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have role="log" on message container', () => {
      renderChatView();

      const container = screen.getByTestId('message-list-container');
      expect(container).toHaveAttribute('role', 'log');
    });

    it('should have aria-live="polite" on message container', () => {
      renderChatView();

      const container = screen.getByTestId('message-list-container');
      expect(container).toHaveAttribute('aria-live', 'polite');
    });

    it('should have aria-label on message container', () => {
      renderChatView();

      const container = screen.getByTestId('message-list-container');
      expect(container).toHaveAttribute('aria-label');
    });
  });

  describe('User Messages vs Assistant Messages', () => {
    it('should render user messages correctly', () => {
      const messages = [createMockMessage({ role: 'user', content: 'Hello from user' })];
      renderChatView({ messages });

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveAttribute('data-role', 'user');
    });

    it('should render assistant messages correctly', () => {
      const messages = [createMockMessage({ role: 'assistant', content: 'Hello from assistant' })];
      renderChatView({ messages });

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveAttribute('data-role', 'assistant');
    });

    it('should render mixed messages correctly', () => {
      const messages = [
        createMockMessage({ id: '1', role: 'user', content: 'User message' }),
        createMockMessage({ id: '2', role: 'assistant', content: 'Assistant message' }),
        createMockMessage({ id: '3', role: 'user', content: 'Another user message' }),
      ];
      renderChatView({ messages });

      const messageItems = screen.getAllByTestId('message-item');
      expect(messageItems[0]).toHaveAttribute('data-role', 'user');
      expect(messageItems[1]).toHaveAttribute('data-role', 'assistant');
      expect(messageItems[2]).toHaveAttribute('data-role', 'user');
    });
  });

  describe('Tool Calls Display', () => {
    it('should render messages with tool calls', () => {
      const messages = [
        createMockMessage({
          role: 'assistant',
          content: 'Let me help you with that.',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'read_file',
              arguments: { path: '/test/file.txt' },
            },
          ],
        }),
      ];
      renderChatView({ messages });

      const toolCallDisplay = screen.getByTestId('tool-call-display');
      expect(toolCallDisplay).toBeInTheDocument();
    });

    it('should render messages with tool results', () => {
      const messages = [
        createMockMessage({
          role: 'assistant',
          content: 'Here is the result.',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'read_file',
              arguments: { path: '/test/file.txt' },
            },
          ],
          toolResults: [
            {
              toolCallId: 'tool-1',
              output: 'File content here',
            },
          ],
        }),
      ];
      renderChatView({ messages });

      const toolResult = screen.getByTestId('tool-result');
      expect(toolResult).toBeInTheDocument();
      expect(toolResult).toHaveTextContent('File content here');
    });
  });
});
