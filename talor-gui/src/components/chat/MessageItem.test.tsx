/**
 * MessageItem Component Tests
 * 消息展示组件测试
 *
 * Tests for the MessageItem component including:
 * - User message styling
 * - Assistant message styling
 * - Tool call display
 * - Streaming indicator
 *
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 * @requirements 3.4 - 显示工具名称、参数和执行结果
 * @requirements 3.5 - 显示流式输出并指示加载状态
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageItem } from './MessageItem';
import type { Message, ToolCall, ToolResult } from '../../types/message';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'message.user': 'You',
        'message.assistant': 'Assistant',
        'message.system': 'System',
        'message.tool': 'Tool',
        'message.toolCall': 'Tool Call',
        'message.toolResult': 'Tool Result',
        'message.toolArguments': 'Arguments',
        'message.toolOutput': 'Output',
        'message.toolError': 'Error',
        'message.streaming': 'Streaming...',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock MarkdownRenderer
vi.mock('../common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

describe('MessageItem', () => {
  const baseMessage: Message = {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello, world!',
    createdAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('User Messages', () => {
    it('should render user message with correct styling', () => {
      const userMessage: Message = {
        ...baseMessage,
        role: 'user',
        content: 'This is a user message',
      };

      render(<MessageItem message={userMessage} />);

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveAttribute('data-role', 'user');

      const roleLabel = screen.getByTestId('message-role');
      expect(roleLabel).toHaveTextContent('You');

      const messageContent = screen.getByTestId('message-content');
      expect(messageContent).toHaveClass('bg-blue-500');
      expect(messageContent).toHaveTextContent('This is a user message');
    });

    it('should render user message as plain text (not markdown)', () => {
      const userMessage: Message = {
        ...baseMessage,
        role: 'user',
        content: '**bold** text',
      };

      render(<MessageItem message={userMessage} />);

      // User messages should NOT use MarkdownRenderer
      expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-text')).toHaveTextContent('**bold** text');
    });

    it('should right-align user messages', () => {
      const userMessage: Message = {
        ...baseMessage,
        role: 'user',
      };

      render(<MessageItem message={userMessage} />);

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveClass('items-end');
    });
  });

  describe('Assistant Messages', () => {
    it('should render assistant message with correct styling', () => {
      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'This is an assistant message',
      };

      render(<MessageItem message={assistantMessage} />);

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveAttribute('data-role', 'assistant');

      const roleLabel = screen.getByTestId('message-role');
      expect(roleLabel).toHaveTextContent('Assistant');

      const messageContent = screen.getByTestId('message-content');
      expect(messageContent).toHaveClass('bg-gray-100');
    });

    it('should render assistant message with markdown', () => {
      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: '**bold** text',
      };

      render(<MessageItem message={assistantMessage} />);

      // Assistant messages should use MarkdownRenderer
      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('**bold** text');
    });

    it('should left-align assistant messages', () => {
      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
      };

      render(<MessageItem message={assistantMessage} />);

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveClass('items-start');
    });
  });

  describe('System Messages', () => {
    it('should render system message with correct styling', () => {
      const systemMessage: Message = {
        ...baseMessage,
        role: 'system',
        content: 'System notification',
      };

      render(<MessageItem message={systemMessage} />);

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toHaveAttribute('data-role', 'system');

      const roleLabel = screen.getByTestId('message-role');
      expect(roleLabel).toHaveTextContent('System');

      const messageContent = screen.getByTestId('message-content');
      expect(messageContent).toHaveClass('bg-yellow-50');
    });
  });

  describe('Tool Calls Display', () => {
    it('should display tool calls for assistant messages', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'read_file',
        arguments: { path: '/test/file.txt' },
      };

      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'Let me read that file for you.',
        toolCalls: [toolCall],
      };

      render(<MessageItem message={assistantMessage} />);

      const toolCallDisplay = screen.getByTestId('tool-call-display');
      expect(toolCallDisplay).toBeInTheDocument();

      // Check tool name is displayed
      expect(toolCallDisplay).toHaveTextContent('read_file');

      // Check arguments are displayed
      const toolArguments = screen.getByTestId('tool-arguments');
      expect(toolArguments).toHaveTextContent('"path"');
      expect(toolArguments).toHaveTextContent('"/test/file.txt"');
    });

    it('should display tool result when available', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'read_file',
        arguments: { path: '/test/file.txt' },
      };

      const toolResult: ToolResult = {
        toolCallId: 'tool-1',
        output: 'File content here',
      };

      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'Here is the file content.',
        toolCalls: [toolCall],
        toolResults: [toolResult],
      };

      render(<MessageItem message={assistantMessage} />);

      const toolResultDisplay = screen.getByTestId('tool-result');
      expect(toolResultDisplay).toBeInTheDocument();
      expect(toolResultDisplay).toHaveTextContent('File content here');
    });

    it('should display tool error when present', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'read_file',
        arguments: { path: '/nonexistent/file.txt' },
      };

      const toolResult: ToolResult = {
        toolCallId: 'tool-1',
        output: '',
        error: 'File not found',
      };

      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'I encountered an error.',
        toolCalls: [toolCall],
        toolResults: [toolResult],
      };

      render(<MessageItem message={assistantMessage} />);

      const toolResultDisplay = screen.getByTestId('tool-result');
      expect(toolResultDisplay).toBeInTheDocument();
      expect(toolResultDisplay).toHaveTextContent('File not found');
      expect(toolResultDisplay).toHaveClass('bg-red-50');
    });

    it('should display multiple tool calls', () => {
      const toolCalls: ToolCall[] = [
        { id: 'tool-1', name: 'read_file', arguments: { path: '/file1.txt' } },
        { id: 'tool-2', name: 'write_file', arguments: { path: '/file2.txt', content: 'test' } },
      ];

      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'Processing files.',
        toolCalls,
      };

      render(<MessageItem message={assistantMessage} />);

      const toolCallDisplays = screen.getAllByTestId('tool-call-display');
      expect(toolCallDisplays).toHaveLength(2);
    });

    it('should not display tool calls for user messages', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'read_file',
        arguments: { path: '/test/file.txt' },
      };

      const userMessage: Message = {
        ...baseMessage,
        role: 'user',
        content: 'User message',
        toolCalls: [toolCall], // This should be ignored
      };

      render(<MessageItem message={userMessage} />);

      expect(screen.queryByTestId('tool-call-display')).not.toBeInTheDocument();
    });
  });

  describe('Streaming Indicator', () => {
    it('should show streaming indicator when isStreaming is true for assistant', () => {
      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'Generating...',
      };

      render(<MessageItem message={assistantMessage} isStreaming={true} />);

      const streamingIndicator = screen.getByTestId('streaming-indicator');
      expect(streamingIndicator).toBeInTheDocument();
      expect(streamingIndicator).toHaveTextContent('Streaming...');
    });

    it('should not show streaming indicator when isStreaming is false', () => {
      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'Complete response',
      };

      render(<MessageItem message={assistantMessage} isStreaming={false} />);

      expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument();
    });

    it('should not show streaming indicator for user messages even when isStreaming is true', () => {
      const userMessage: Message = {
        ...baseMessage,
        role: 'user',
        content: 'User message',
      };

      render(<MessageItem message={userMessage} isStreaming={true} />);

      expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument();
    });
  });

  describe('Timestamp Display', () => {
    it('should display formatted timestamp', () => {
      const message: Message = {
        ...baseMessage,
        createdAt: new Date('2024-01-15T10:30:00').getTime(),
      };

      render(<MessageItem message={message} />);

      const timeDisplay = screen.getByTestId('message-time');
      expect(timeDisplay).toBeInTheDocument();
      // The exact format depends on locale, but it should contain time
      expect(timeDisplay.textContent).toBeTruthy();
    });
  });

  describe('Empty Content', () => {
    it('should handle empty content gracefully', () => {
      const message: Message = {
        ...baseMessage,
        content: '',
      };

      render(<MessageItem message={message} />);

      const messageItem = screen.getByTestId('message-item');
      expect(messageItem).toBeInTheDocument();
    });

    it('should display tool calls even with empty content', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'execute_command',
        arguments: { command: 'ls' },
      };

      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: '',
        toolCalls: [toolCall],
      };

      render(<MessageItem message={assistantMessage} />);

      const toolCallDisplay = screen.getByTestId('tool-call-display');
      expect(toolCallDisplay).toBeInTheDocument();
    });
  });

  describe('Complex Tool Arguments', () => {
    it('should format nested object arguments', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'api_call',
        arguments: {
          url: 'https://api.example.com',
          method: 'POST',
          body: {
            name: 'test',
            values: [1, 2, 3],
          },
        },
      };

      const assistantMessage: Message = {
        ...baseMessage,
        role: 'assistant',
        content: 'Making API call.',
        toolCalls: [toolCall],
      };

      render(<MessageItem message={assistantMessage} />);

      const toolArguments = screen.getByTestId('tool-arguments');
      expect(toolArguments).toHaveTextContent('"url"');
      expect(toolArguments).toHaveTextContent('"https://api.example.com"');
      expect(toolArguments).toHaveTextContent('"body"');
    });
  });
});
