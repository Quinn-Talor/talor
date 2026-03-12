/**
 * ActivityList Component
 * 统一活动流列表
 *
 * Replaces SessionList with a unified feed that mixes sessions and tasks.
 * Running tasks are always shown at the top with a pulsing indicator.
 */

import React, { useCallback, useMemo } from 'react';
import type { TaskInfo } from '../../api/task';
import type { SessionInfo } from '../../types/session';
import { SessionItem } from './SessionItem';

interface ActivityListProps {
  sessions: SessionInfo[];
  tasks: TaskInfo[];
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onSelectTask: (task: TaskInfo) => void;
  onAssignTask: () => void;
  isLoading?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  return `${days}天前`;
}

function getTaskStatusIcon(status: TaskInfo['status']): React.ReactNode {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
      );
    case 'queued':
      return <span className="inline-flex rounded-full h-2 w-2 bg-yellow-400 flex-shrink-0" />;
    case 'completed':
      return <span className="text-green-500 flex-shrink-0 text-xs">✓</span>;
    case 'failed':
      return <span className="text-red-500 flex-shrink-0 text-xs">✕</span>;
    case 'cancelled':
      return <span className="text-gray-400 flex-shrink-0 text-xs">–</span>;
    default:
      return <span className="inline-flex rounded-full h-2 w-2 bg-gray-300 flex-shrink-0" />;
  }
}

function getTaskStatusText(task: TaskInfo): string {
  switch (task.status) {
    case 'running':
      return task.currentAction ?? '运行中';
    case 'queued':
      return '排队中';
    case 'completed': {
      const count = task.artifacts.length;
      return count > 0 ? `完成 · ${count} 个成果文件` : '已完成';
    }
    case 'failed':
      return `失败: ${task.error ?? '未知错误'}`;
    case 'cancelled':
      return '已取消';
    default:
      return '待处理';
  }
}

const TaskItem: React.FC<{
  task: TaskInfo;
  isSelected: boolean;
  onSelect: (task: TaskInfo) => void;
}> = ({ task, isSelected, onSelect }) => {
  const isActive = task.status === 'running' || task.status === 'queued';
  return (
    <button
      type="button"
      onClick={() => onSelect(task)}
      className={`
        w-full text-left px-3 py-2.5 rounded-lg
        transition-colors duration-100
        ${isSelected
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
        }
      `}
    >
      <div className="flex items-start gap-2">
        <div className="mt-1">{getTaskStatusIcon(task.status)}</div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium truncate ${isActive ? 'text-blue-700 dark:text-blue-300' : ''}`}>
            {task.title}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {getTaskStatusText(task)}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {task.agentId} · {formatRelativeTime(task.updatedAt)}
          </p>
        </div>
      </div>
    </button>
  );
};

export const ActivityList: React.FC<ActivityListProps> = ({
  sessions,
  tasks,
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onSelectTask,
  onAssignTask,
  isLoading = false,
}) => {
  // Separate running/queued tasks from finished ones
  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status === 'running' || t.status === 'queued')
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks]
  );

  const finishedTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'running' && t.status !== 'queued')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5), // Show last 5
    [tasks]
  );

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  // Determine if a task session is the current view
  const currentTaskId = useMemo(
    () => tasks.find((t) => t.sessionId === currentSessionId)?.id,
    [tasks, currentSessionId]
  );

  const handleSelectTask = useCallback(
    (task: TaskInfo) => {
      onSelectTask(task);
    },
    [onSelectTask]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 gap-1">
        <button
          type="button"
          onClick={onAssignTask}
          className="
            flex items-center gap-1
            px-2 py-1 text-xs font-medium
            text-blue-600 dark:text-blue-400
            hover:bg-blue-50 dark:hover:bg-blue-900/30
            rounded-md transition-colors
          "
          title="指派工作"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          指派工作
        </button>
        <button
          type="button"
          onClick={onCreateSession}
          disabled={isLoading}
          className="
            flex items-center gap-1
            px-2 py-1 text-xs font-medium
            text-gray-600 dark:text-gray-400
            hover:bg-gray-100 dark:hover:bg-gray-700
            rounded-md transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          title="新对话"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          新对话
        </button>
      </div>

      {/* Activity feed */}
      <div className="flex-1 overflow-y-auto">
        {/* Running tasks section */}
        {activeTasks.length > 0 && (
          <div className="px-2 pt-2">
            <p className="px-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
              进行中
            </p>
            <div className="space-y-0.5">
              {activeTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  isSelected={task.id === currentTaskId}
                  onSelect={handleSelectTask}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent section (sessions + finished tasks mixed) */}
        <div className="px-2 pt-2">
          {(activeTasks.length > 0 || finishedTasks.length > 0) && (
            <p className="px-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
              最近
            </p>
          )}

          {/* Finished tasks */}
          <div className="space-y-0.5">
            {finishedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                isSelected={task.id === currentTaskId}
                onSelect={handleSelectTask}
              />
            ))}
          </div>

          {/* Sessions */}
          {isLoading && sortedSessions.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-gray-400">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
            </div>
          ) : (
            <div className="space-y-0.5">
              {sortedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isSelected={session.id === currentSessionId && !currentTaskId}
                  onSelect={onSelectSession}
                  onDelete={onDeleteSession}
                  onRename={onRenameSession}
                />
              ))}
            </div>
          )}

          {sortedSessions.length === 0 && tasks.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-gray-500">
              <p className="text-sm">暂无活动</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityList;
