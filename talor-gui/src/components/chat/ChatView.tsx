/**
 * ChatView Component
 * 聊天视图组件
 *
 * Displays a list of messages in a chat session with auto-scroll functionality,
 * scroll-to-bottom button, empty state, and loading indicator.
 *
 * @requirements 3.6 - 支持消息的滚动浏览和自动滚动到最新消息
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../types/message';
import { MessageItem } from './MessageItem';

/**
 * Props for the ChatView component
 * ChatView 组件的属性
 */
export interface ChatViewProps {
  /** Session ID / 会话ID */
  sessionId: string;
  /** List of messages to display / 要显示的消息列表 */
  messages: Message[];
  /** Whether the chat is loading / 是否正在加载 */
  isLoading: boolean;
  /** Callback when user sends a message / 用户发送消息时的回调 */
  onSendMessage: (content: string) => void;
  /** Callback when user retries a message / 用户重试消息时的回调 */
  onRetry: (messageId: string) => void;
  /** ID of the message currently streaming (if any) / 当前正在流式输出的消息ID */
  streamingMessageId?: string;
}

/**
 * Threshold in pixels for showing the scroll-to-bottom button
 * 显示滚动到底部按钮的阈值（像素）
 */
const SCROLL_THRESHOLD = 100;

/**
 * ChatView component
 * 聊天视图组件
 *
 * Displays messages in a scrollable container with auto-scroll to latest
 * messages and a scroll-to-bottom button when the user scrolls up.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered chat view / 渲染后的聊天视图
 *
 * @requirements 3.6 - 支持消息的滚动浏览和自动滚动到最新消息
 */
export const ChatView: React.FC<ChatViewProps> = ({
  sessionId,
  messages,
  isLoading,
  streamingMessageId,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const lastMessageCountRef = useRef(messages.length);
  const lastStreamingContentRef = useRef<string>('');

  /**
   * Check if the container is scrolled near the bottom
   * 检查容器是否滚动到接近底部
   */
  const isNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
  }, []);

  /**
   * Scroll to the bottom of the message list
   * 滚动到消息列表底部
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  /**
   * Handle scroll events to show/hide the scroll-to-bottom button
   * 处理滚动事件以显示/隐藏滚动到底部按钮
   */
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    setShowScrollButton(!nearBottom);
    
    // If user scrolls up, mark as user scrolling
    if (!nearBottom) {
      setIsUserScrolling(true);
    } else {
      setIsUserScrolling(false);
    }
  }, [isNearBottom]);

  /**
   * Auto-scroll to bottom when new messages arrive (count changes)
   * 新消息到达时自动滚动到底部（数量变化）
   */
  useEffect(() => {
    const messageCountChanged = messages.length !== lastMessageCountRef.current;
    lastMessageCountRef.current = messages.length;

    // Auto-scroll only when message count changes and user is not manually scrolling
    if (messageCountChanged && !isUserScrolling) {
      scrollToBottom('smooth');
    }
  }, [messages.length, isUserScrolling, scrollToBottom]);

  /**
   * Auto-scroll during streaming (throttled)
   * 流式输出时自动滚动（节流）
   */
  useEffect(() => {
    if (!streamingMessageId || isUserScrolling) return;

    // Find the streaming message content
    const streamingMessage = messages.find(m => m.id === streamingMessageId);
    const currentContent = streamingMessage?.content ?? '';
    
    // Only scroll if content has grown significantly (every 100 chars)
    const contentLengthDiff = currentContent.length - lastStreamingContentRef.current.length;
    if (contentLengthDiff > 100 || (currentContent.length > 0 && lastStreamingContentRef.current.length === 0)) {
      lastStreamingContentRef.current = currentContent;
      scrollToBottom('smooth');
    }
  }, [streamingMessageId, messages, isUserScrolling, scrollToBottom]);

  /**
   * Reset streaming content ref when streaming ends
   * 流式结束时重置内容引用
   */
  useEffect(() => {
    if (!streamingMessageId) {
      lastStreamingContentRef.current = '';
    }
  }, [streamingMessageId]);

  /**
   * Reset scroll state when session changes
   * 会话切换时重置滚动状态
   */
  useEffect(() => {
    setIsUserScrolling(false);
    setShowScrollButton(false);
    lastStreamingContentRef.current = '';
    // Scroll to bottom immediately when session changes
    scrollToBottom('instant');
  }, [sessionId, scrollToBottom]);

  /**
   * Render empty state when there are no messages
   * 没有消息时渲染空状态
   */
  const renderEmptyState = () => (
    <div
      className="
        flex flex-col items-center justify-center
        h-full
        text-gray-500 dark:text-gray-400
      "
      data-testid="chat-empty-state"
    >
      <svg
        className="w-16 h-16 mb-4 text-gray-300 dark:text-gray-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <p className="text-lg font-medium mb-2">{t('chat.noMessages')}</p>
      <p className="text-sm">{t('chat.startConversation')}</p>
    </div>
  );

  /**
   * Render loading indicator
   * 渲染加载指示器
   */
  const renderLoadingIndicator = () => (
    <div
      className="
        flex items-center justify-center
        py-4
        text-gray-500 dark:text-gray-400
      "
      data-testid="chat-loading-indicator"
    >
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          <span
            className="
              w-2 h-2 rounded-full
              bg-blue-500 dark:bg-blue-400
              animate-bounce
            "
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="
              w-2 h-2 rounded-full
              bg-blue-500 dark:bg-blue-400
              animate-bounce
            "
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="
              w-2 h-2 rounded-full
              bg-blue-500 dark:bg-blue-400
              animate-bounce
            "
            style={{ animationDelay: '300ms' }}
          />
        </div>
        <span className="text-sm">{t('chat.thinking')}</span>
      </div>
    </div>
  );

  /**
   * Render scroll-to-bottom button
   * 渲染滚动到底部按钮
   */
  const renderScrollButton = () => (
    <button
      type="button"
      onClick={() => {
        scrollToBottom('smooth');
        setShowScrollButton(false);
        setIsUserScrolling(false);
      }}
      className="
        absolute bottom-4 right-4
        flex items-center gap-2
        px-3 py-2
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        rounded-full
        shadow-lg
        text-sm text-gray-700 dark:text-gray-300
        hover:bg-gray-50 dark:hover:bg-gray-700
        transition-all duration-200
        z-10
      "
      data-testid="scroll-to-bottom-button"
      aria-label={t('chat.scrollToBottom')}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 14l-7 7m0 0l-7-7m7 7V3"
        />
      </svg>
      <span>{t('chat.scrollToBottom')}</span>
    </button>
  );

  return (
    <div
      className="relative flex flex-col h-full min-h-0 overflow-hidden"
      data-testid="chat-view"
      data-session-id={sessionId}
    >
      {/* Message list container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="
          flex-1 overflow-y-auto min-h-0
          px-4 py-4
          scroll-smooth
        "
        data-testid="message-list-container"
        role="log"
        aria-label={t('a11y.chatArea')}
        aria-live="polite"
      >
        {messages.length === 0 && !isLoading ? (
          renderEmptyState()
        ) : (
          <div className="max-w-4xl mx-auto">
            {/* Message list */}
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                isStreaming={message.id === streamingMessageId}
              />
            ))}

            {/* Loading indicator (when waiting for response but no streaming message yet) */}
            {isLoading && !streamingMessageId && renderLoadingIndicator()}

            {/* Scroll anchor */}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && renderScrollButton()}
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default ChatView;
