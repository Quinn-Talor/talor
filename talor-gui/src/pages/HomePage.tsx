/**
 * HomePage Component
 * 主页面组件
 *
 * Integrates the unified ActivityList sidebar (sessions + tasks),
 * ChatView with optional TaskStatusBar overlay, WorkspaceDrawer,
 * and AssignTaskModal.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createAgentApi } from '../api/agent';
import { TalorClient } from '../api/client';
import type { AgentInfo } from '../api/agent';
import type { TaskInfo } from '../api/task';
import { ChatView, PromptInput } from '../components/chat';
import { ActivityList } from '../components/session';
import { AssignTaskModal, TaskStatusBar, WorkspaceDrawer } from '../components/task';
import { getSessionPath } from '../router';
import { useSessionStore } from '../store/session';
import { useTaskStore } from '../store/task';

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Debug: Log URL changes
  useEffect(() => {
    console.debug('[HomePage] Location changed:', location.pathname, { sessionId });
  }, [location.pathname, sessionId]);

  // Local state
  const [inputValue, setInputValue] = useState('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | undefined>();
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showWorkspaceDrawer, setShowWorkspaceDrawer] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  // Session store
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

  // Task store
  const {
    tasks,
    isCreating: isCreatingTask,
    fetchTasks,
    createTask,
    cancelTask,
  } = useTaskStore();

  // Find if current session is a task session
  const currentTask = tasks.find((t) => t.sessionId === currentSessionId) ?? null;
  const taskApi = useTaskStore.getState()._taskApi;

  // Agents cache ref to avoid refetching
  const agentsFetched = useRef(false);

  // Fetch agents for modal (lazy)
  const fetchAgents = useCallback(async () => {
    if (agentsFetched.current || agentsLoading) return;
    agentsFetched.current = true;
    setAgentsLoading(true);
    try {
      const talorClient = new TalorClient({ baseUrl: DEFAULT_API_BASE_URL, timeout: 10000 });
      const agentApi = createAgentApi(talorClient);
      const allAgents = await agentApi.list();
      // Only show worker agents in the modal
      setAgents(allAgents.filter((a) => !a.hidden));
    } catch {
      setAgents([]);
    } finally {
      setAgentsLoading(false);
    }
  }, [agentsLoading]);

  // On mount: fetch sessions and tasks
  useEffect(() => {
    let mounted = true;

    fetchSessions()
      .then(() => {
        if (!mounted) return;
        const { sessions: currentSessions, currentSessionId: currentId } = useSessionStore.getState();
        if (!sessionId) {
          if (currentSessions.length === 0 && !currentId) {
            createSession()
              .then((session) => {
                if (mounted) navigate(getSessionPath(session.id));
              })
              .catch(() => {});
          } else if (currentSessions.length > 0 && !currentId) {
            const firstSession = currentSessions[0];
            selectSession(firstSession.id)
              .then(() => {
                if (mounted) navigate(getSessionPath(firstSession.id));
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});

    fetchTasks().catch(() => {});

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL session ID with store
  useEffect(() => {
    if (sessionId && sessionId !== currentSessionId) {
      const sessionExists = sessions.some((s) => s.id === sessionId);
      if (sessionExists) {
        selectSession(sessionId).catch(() => {});
      } else if (sessions.length > 0) {
        selectSession(sessionId).catch((err) => {
          if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
            navigate('/', { replace: true });
          }
        });
      } else {
        selectSession(sessionId).catch((err) => {
          if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
            navigate('/', { replace: true });
          }
        });
      }
    }
  }, [sessionId, currentSessionId, sessions, selectSession, navigate]);

  // Handle session selection
  const handleSelectSession = useCallback(
    async (selectedSessionId: string) => {
      try {
        await selectSession(selectedSessionId);
        navigate(getSessionPath(selectedSessionId));
      } catch {}
    },
    [selectSession, navigate]
  );

  // Handle task selection: navigate to the task's session
  const handleSelectTask = useCallback(
    async (task: TaskInfo) => {
      try {
        await selectSession(task.sessionId);
        navigate(getSessionPath(task.sessionId));
      } catch {}
    },
    [selectSession, navigate]
  );

  // Handle creating a new session
  const handleCreateSession = useCallback(async () => {
    try {
      const session = await createSession();
      navigate(getSessionPath(session.id));
    } catch {}
  }, [createSession, navigate]);

  // Handle deleting a session
  const handleDeleteSession = useCallback(
    async (sessionIdToDelete: string) => {
      try {
        await deleteSession(sessionIdToDelete);
        if (sessionIdToDelete === currentSessionId) {
          navigate('/', { replace: true });
        }
      } catch {}
    },
    [deleteSession, currentSessionId, navigate]
  );

  // Handle renaming a session (placeholder)
  const handleRenameSession = useCallback((_id: string, _title: string) => {}, []);

  // Handle opening assign modal
  const handleOpenAssignModal = useCallback(() => {
    fetchAgents();
    setShowAssignModal(true);
  }, [fetchAgents]);

  // Handle submitting a new task
  const handleCreateTask = useCallback(
    async (params: { title: string; agentId: string; prompt: string; useWorktree: boolean }) => {
      const task = await createTask({
        title: params.title,
        agentId: params.agentId,
        prompt: params.prompt,
        useWorktree: params.useWorktree,
      });
      // Navigate to the task's session
      await selectSession(task.sessionId);
      navigate(getSessionPath(task.sessionId));
    },
    [createTask, selectSession, navigate]
  );

  // Handle cancelling the current task
  const handleCancelTask = useCallback(async () => {
    if (currentTask) {
      await cancelTask(currentTask.id);
    }
  }, [cancelTask, currentTask]);

  // Handle file preview in workspace drawer
  const handlePreviewFile = useCallback(
    async (path: string): Promise<string> => {
      if (!currentTask || !taskApi) return '';
      return taskApi.previewFile(currentTask.id, path);
    },
    [currentTask, taskApi]
  );

  // Handle sending a message
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || !currentSessionId) return;
    const messageContent = inputValue.trim();
    setInputValue('');
    try {
      const tempId = `streaming_${Date.now()}`;
      setStreamingMessageId(tempId);
      await sendMessageAsync(messageContent);
    } catch {
      // error handled in store
    } finally {
      setStreamingMessageId(undefined);
    }
  }, [inputValue, currentSessionId, sendMessageAsync]);

  const handleRetryMessage = useCallback((_messageId: string) => {}, []);

  const currentMessages = currentSessionId ? messages[currentSessionId] ?? [] : [];

  // Welcome / error states
  const renderWelcomeState = () => (
    <div
      className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8"
      data-testid="home-welcome-state"
    >
      <svg className="w-20 h-20 mb-6 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{t('nav.home')}</h2>
      <p className="text-center mb-6 max-w-md">{t('session.startNew')}</p>
      <button
        type="button"
        onClick={handleCreateSession}
        disabled={isLoading}
        className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
        data-testid="home-create-session-button"
      >
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {t('session.new')}
      </button>
    </div>
  );

  const renderErrorState = () => (
    <div
      className="flex flex-col items-center justify-center h-full text-red-500 dark:text-red-400 p-8"
      data-testid="home-error-state"
    >
      <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <h3 className="text-lg font-semibold mb-2">{t('error.title')}</h3>
      <p className="text-center mb-4 text-gray-600 dark:text-gray-400">{error}</p>
      <button
        type="button"
        onClick={clearError}
        className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors duration-150"
      >
        {t('common.close')}
      </button>
    </div>
  );

  // Show workspace button only if current session is a completed/running task with artifacts
  const showWorkspaceBtn = currentTask && currentTask.artifacts.length > 0;

  return (
    <div className="flex h-screen w-full" data-testid="home-page">
      {/* Sidebar */}
      <aside
        className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hidden md:flex md:flex-col overflow-hidden"
        data-testid="home-sidebar"
      >
        <ActivityList
          sessions={sessions}
          tasks={tasks}
          currentSessionId={currentSessionId ?? undefined}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onSelectTask={handleSelectTask}
          onAssignTask={handleOpenAssignModal}
          isLoading={isLoading}
        />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden" data-testid="home-main-content">
        {error ? (
          renderErrorState()
        ) : !currentSessionId ? (
          renderWelcomeState()
        ) : (
          <>
            {/* Task status bar (only when viewing a running/queued task session) */}
            {currentTask && (currentTask.status === 'running' || currentTask.status === 'queued') && (
              <TaskStatusBar task={currentTask} onCancel={handleCancelTask} />
            )}

            {/* Chat View Container - fixed height with flex layout */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
              <ChatView
                sessionId={currentSessionId}
                messages={currentMessages}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                onRetry={handleRetryMessage}
                streamingMessageId={streamingMessageId}
              />

              {/* Workspace button (floating, bottom-right) */}
              {showWorkspaceBtn && !showWorkspaceDrawer && (
                <button
                  type="button"
                  onClick={() => setShowWorkspaceDrawer(true)}
                  className="
                    absolute bottom-4 right-4 z-10
                    flex items-center gap-1.5
                    px-3 py-1.5 text-sm font-medium
                    text-gray-700 dark:text-gray-300
                    bg-white dark:bg-gray-800
                    border border-gray-200 dark:border-gray-700
                    rounded-full shadow-md
                    hover:bg-gray-50 dark:hover:bg-gray-700
                    transition-colors
                  "
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  查看成果 ({currentTask.artifacts.length})
                </button>
              )}
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

      {/* Workspace Drawer */}
      {currentTask && (
        <WorkspaceDrawer
          isOpen={showWorkspaceDrawer}
          onClose={() => setShowWorkspaceDrawer(false)}
          taskId={currentTask.id}
          artifacts={currentTask.artifacts}
          onPreviewFile={handlePreviewFile}
        />
      )}

      {/* Assign Task Modal */}
      <AssignTaskModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        onSubmit={handleCreateTask}
        agents={agents}
        isLoading={agentsLoading || isCreatingTask}
      />
    </div>
  );
};

export default HomePage;
