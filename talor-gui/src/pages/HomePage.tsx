/**
 * HomePage Component
 * 主页面组件
 *
 * The main page of the Talor GUI application that integrates the session list
 * and chat view components. Handles session selection, message display, and
 * user interactions.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChatView, PromptInput } from '../components/chat';
import { SessionList } from '../components/session';
import { getSessionPath } from '../router';
import { useSessionStore } from '../store/session';

/**
 * HomePage component
 * 主页面组件
 *
 * Displays the session list in the sidebar and the chat view in the main area.
 * Manages session selection, message sending, and navigation.
 *
 * @returns Rendered home page / 渲染后的主页面
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 */
export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Debug: Log URL changes
  useEffect(() => {
    console.debug('[HomePage] Location changed:', location.pathname, { sessionId, currentSessionId });
  }, [location.pathname, sessionId]);

  // Local state for input value
  const [inputValue, setInputValue] = useState('');
  // Track streaming message ID
  const [streamingMessageId, setStreamingMessageId] = useState<string | undefined>();

  // Session store state and actions
  const {
    sessions,
    currentSessionId,
    messages,
    isLoading,
    error,
    fetchSessions,
    createSession,
    selectSession,
    deleteSession,
    sendMessageAsync,
    clearError,
  } = useSessionStore();

  // Debug: Log store state changes
  useEffect(() => {
    console.debug('[HomePage] Store state:', {
      sessionsCount: sessions.length,
      currentSessionId,
      isLoading,
      error,
      urlSessionId: sessionId,
    });
  }, [sessions.length, currentSessionId, isLoading, error, sessionId]);

  /**
   * Fetch sessions on mount and auto-create if none exist
   * 组件挂载时获取会话列表，如果没有会话则自动创建
   */
  useEffect(() => {
    let mounted = true;

    fetchSessions()
      .then(() => {
        if (!mounted) return;

        // Auto-create a session if none exist and no session is selected
        const { sessions: currentSessions, currentSessionId: currentId } = useSessionStore.getState();

        // Only auto-create/select if we're on the home page (no sessionId in URL)
        if (!sessionId) {
          if (currentSessions.length === 0 && !currentId) {
            // No sessions exist, create one
            createSession()
              .then((session) => {
                if (mounted) {
                  navigate(getSessionPath(session.id));
                }
              })
              .catch(() => {
                // Error is handled in the store
              });
          } else if (currentSessions.length > 0 && !currentId) {
            // Sessions exist but none selected, select the first one
            const firstSession = currentSessions[0];
            selectSession(firstSession.id)
              .then(() => {
                if (mounted) {
                  navigate(getSessionPath(firstSession.id));
                }
              })
              .catch(() => {
                // Error is handled in the store
              });
          }
        }
      })
      .catch(() => {
        // Error is handled in the store
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  /**
   * Sync URL session ID with store
   * 同步 URL 中的会话 ID 到 store
   */
  useEffect(() => {
    // Only sync if we have a sessionId in the URL and it's different from the store
    if (sessionId && sessionId !== currentSessionId) {
      console.debug('[HomePage] Syncing URL session ID to store:', sessionId, 'current:', currentSessionId);

      // Check if the session exists in our sessions list first
      const sessionExists = sessions.some(s => s.id === sessionId);

      if (sessionExists) {
        // Session exists, just select it
        selectSession(sessionId).catch((err) => {
          console.error('[HomePage] Failed to select existing session:', sessionId, err);
          // Don't navigate away - the session exists, it's just a temporary error
        });
      } else if (sessions.length > 0) {
        // Session doesn't exist in our list, but we have other sessions
        // This might happen if the session was deleted or the URL is stale
        console.warn('[HomePage] Session not found in list:', sessionId);
        // Try to select anyway - it might be a new session not yet in the list
        selectSession(sessionId).catch((err) => {
          console.error('[HomePage] Failed to select session:', sessionId, err);
          // Only navigate to home if the session truly doesn't exist
          if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
            navigate('/', { replace: true });
          }
        });
      } else {
        // No sessions loaded yet, try to select
        selectSession(sessionId).catch((err) => {
          console.error('[HomePage] Failed to select session (no sessions loaded):', sessionId, err);
          // Only navigate to home if the session truly doesn't exist
          if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
            navigate('/', { replace: true });
          }
        });
      }
    }
  }, [sessionId, currentSessionId, sessions, selectSession, navigate]);

  /**
   * Handle session selection
   * 处理会话选择
   *
   * @param selectedSessionId - The selected session ID / 选中的会话 ID
   */
  const handleSelectSession = useCallback(
    async (selectedSessionId: string) => {
      try {
        await selectSession(selectedSessionId);
        navigate(getSessionPath(selectedSessionId));
      } catch {
        // Error is handled in the store
      }
    },
    [selectSession, navigate]
  );

  /**
   * Handle creating a new session
   * 处理创建新会话
   *
   * @requirements 2.1 - 创建新会话并切换到该会话
   */
  const handleCreateSession = useCallback(async () => {
    try {
      const session = await createSession();
      navigate(getSessionPath(session.id));
    } catch {
      // Error is handled in the store
    }
  }, [createSession, navigate]);

  /**
   * Handle deleting a session
   * 处理删除会话
   */
  const handleDeleteSession = useCallback(
    async (sessionIdToDelete: string) => {
      try {
        await deleteSession(sessionIdToDelete);
        // If the deleted session was the current one, navigate to home
        if (sessionIdToDelete === currentSessionId) {
          navigate('/', { replace: true });
        }
      } catch {
        // Error is handled in the store
      }
    },
    [deleteSession, currentSessionId, navigate]
  );

  /**
   * Handle renaming a session
   * 处理重命名会话
   *
   * Note: This is a placeholder - actual rename functionality
   * would need to be implemented in the session store
   */
  const handleRenameSession = useCallback(
    (_sessionIdToRename: string, _newTitle: string) => {
      // TODO: Implement rename functionality in session store
      console.log('Rename session:', _sessionIdToRename, _newTitle);
    },
    []
  );

  /**
   * Handle sending a message (方案 B - 分离式架构)
   * 处理发送消息（方案 B - 分离式架构）
   *
   * Uses sendMessageAsync which sends the prompt to /api/session/prompt/async
   * and receives responses via the /event SSE stream.
   */
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || !currentSessionId) {
      console.debug('[HomePage] Cannot send message:', { hasInput: !!inputValue.trim(), currentSessionId });
      return;
    }

    const messageContent = inputValue.trim();
    setInputValue(''); // Clear input immediately

    console.debug('[HomePage] Sending message:', { sessionId: currentSessionId, contentLength: messageContent.length });

    try {
      // Generate a temporary streaming message ID
      const tempStreamingId = `streaming_${Date.now()}`;
      setStreamingMessageId(tempStreamingId);

      // Use async mode (方案 B) - response comes via /event SSE stream
      await sendMessageAsync(messageContent);
      console.debug('[HomePage] Message sent successfully');
    } catch (err) {
      console.error('[HomePage] Failed to send message:', err);
      // Error is handled in the store
    } finally {
      // Note: streamingMessageId will be cleared when stream.done event is received
      // For now, clear it here as a fallback
      setStreamingMessageId(undefined);
    }
  }, [inputValue, currentSessionId, sendMessageAsync]);

  /**
   * Handle message retry
   * 处理消息重试
   */
  const handleRetryMessage = useCallback((_messageId: string) => {
    // TODO: Implement retry functionality
    console.log('Retry message:', _messageId);
  }, []);

  /**
   * Get current session messages
   * 获取当前会话的消息
   */
  const currentMessages = currentSessionId ? messages[currentSessionId] ?? [] : [];

  /**
   * Render welcome state when no session is selected
   * 未选择会话时渲染欢迎状态
   */
  const renderWelcomeState = () => (
    <div
      className="
        flex flex-col items-center justify-center
        h-full
        text-gray-500 dark:text-gray-400
        p-8
      "
      data-testid="home-welcome-state"
    >
      <svg
        className="w-20 h-20 mb-6 text-gray-300 dark:text-gray-600"
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
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
        {t('nav.home')}
      </h2>
      <p className="text-center mb-6 max-w-md">
        {t('session.startNew')}
      </p>
      <button
        type="button"
        onClick={handleCreateSession}
        disabled={isLoading}
        className="
          inline-flex items-center
          px-4 py-2
          text-sm font-medium
          text-white
          bg-blue-600 hover:bg-blue-700
          dark:bg-blue-500 dark:hover:bg-blue-600
          rounded-lg
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          dark:focus:ring-offset-gray-800
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors duration-150
        "
        data-testid="home-create-session-button"
      >
        <svg
          className="w-5 h-5 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        {t('session.new')}
      </button>
    </div>
  );

  /**
   * Render error state
   * 渲染错误状态
   */
  const renderErrorState = () => (
    <div
      className="
        flex flex-col items-center justify-center
        h-full
        text-red-500 dark:text-red-400
        p-8
      "
      data-testid="home-error-state"
    >
      <svg
        className="w-16 h-16 mb-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <h3 className="text-lg font-semibold mb-2">{t('error.title')}</h3>
      <p className="text-center mb-4 text-gray-600 dark:text-gray-400">
        {error}
      </p>
      <button
        type="button"
        onClick={clearError}
        className="
          px-4 py-2
          text-sm font-medium
          text-blue-600 dark:text-blue-400
          hover:bg-blue-50 dark:hover:bg-blue-900/30
          rounded-lg
          transition-colors duration-150
        "
      >
        {t('common.close')}
      </button>
    </div>
  );

  return (
    <div
      className="flex h-full"
      data-testid="home-page"
    >
      {/* Session List Sidebar */}
      <aside
        className="
          w-64 flex-shrink-0
          border-r border-gray-200 dark:border-gray-700
          bg-gray-50 dark:bg-gray-900
          hidden md:block
        "
        data-testid="home-sidebar"
      >
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId ?? undefined}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onDelete={handleDeleteSession}
          onRename={handleRenameSession}
          isLoading={isLoading}
        />
      </aside>

      {/* Main Content Area */}
      <div
        className="flex-1 flex flex-col min-w-0"
        data-testid="home-main-content"
      >
        {error ? (
          renderErrorState()
        ) : !currentSessionId ? (
          renderWelcomeState()
        ) : (
          <>
            {/* Chat View */}
            <div className="flex-1 overflow-hidden">
              <ChatView
                sessionId={currentSessionId}
                messages={currentMessages}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                onRetry={handleRetryMessage}
                streamingMessageId={streamingMessageId}
              />
            </div>

            {/* Prompt Input */}
            <PromptInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSendMessage}
              disabled={isLoading}
            />
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default HomePage;
