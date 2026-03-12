/**
 * TaskStatusBar Component
 * 任务状态条组件
 *
 * Displayed at the top of the ChatView when viewing a running task.
 * Shows task title, agent, elapsed time, progress, and a stop button.
 */

import React, { useEffect, useState } from 'react';
import type { TaskInfo } from '../../api/task';

interface TaskStatusBarProps {
  task: TaskInfo;
  onCancel: () => void;
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return '';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export const TaskStatusBar: React.FC<TaskStatusBarProps> = ({ task, onCancel }) => {
  const [elapsed, setElapsed] = useState(() => formatElapsed(task.startedAt));

  useEffect(() => {
    if (task.status !== 'running') return;
    const timer = setInterval(() => {
      setElapsed(formatElapsed(task.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [task.status, task.startedAt]);

  if (task.status !== 'running' && task.status !== 'queued') return null;

  const isRunning = task.status === 'running';

  return (
    <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {/* Pulse indicator */}
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            {isRunning ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" />
            )}
          </span>

          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {task.title}
          </span>

          {task.agentId && (
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              · {task.agentId}
            </span>
          )}

          {elapsed && isRunning && (
            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
              · {elapsed}
            </span>
          )}

          {task.status === 'queued' && (
            <span className="text-xs text-yellow-600 dark:text-yellow-400 flex-shrink-0">
              · 排队中
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="flex-shrink-0 ml-3 px-2 py-0.5 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          停止
        </button>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1">
            <div
              className="bg-blue-500 h-1 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(task.progress, 2)}%` }}
            />
          </div>
          {task.currentAction && (
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
              {task.currentAction}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskStatusBar;
