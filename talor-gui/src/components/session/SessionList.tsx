/**
 * SessionList Component
 * 会话列表组件
 *
 * Main session list component that displays all sessions and provides
 * functionality for creating, selecting, deleting, and renaming sessions.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 2.2 - 选择现有会话加载消息历史
 * @requirements 2.3 - 删除会话并从列表中移除
 * @requirements 2.4 - 显示会话的标题、创建时间和最后更新时间
 * @requirements 2.5 - 按最后更新时间降序排列
 * @requirements 2.6 - 重命名会话并持久化
 *
 * @property 5 - 会话删除后列表更新 - After session deletion, the session list should not contain the deleted session
 * @property 6 - 会话列表排序 - Session list should be sorted by last update time in descending order
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionInfo } from '../../types/session';
import { SessionItem } from './SessionItem';

/**
 * SessionList props interface
 * 会话列表属性接口
 */
export interface SessionListProps {
  /** List of sessions to display / 要显示的会话列表 */
  sessions: SessionInfo[];
  /** Currently selected session ID / 当前选中的会话 ID */
  currentSessionId?: string;
  /** Callback when a session is selected / 选择会话时的回调 */
  onSelect: (sessionId: string) => void;
  /** Callback when creating a new session / 创建新会话时的回调 */
  onCreate: () => void;
  /** Callback when deleting a session / 删除会话时的回调 */
  onDelete: (sessionId: string) => void;
  /** Callback when renaming a session / 重命名会话时的回调 */
  onRename: (sessionId: string, title: string) => void;
  /** Whether the list is loading / 是否正在加载 */
  isLoading?: boolean;
  /** Custom class name / 自定义类名 */
  className?: string;
}

/**
 * Plus icon component for new session button
 * 新建会话按钮的加号图标组件
 */
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 4v16m8-8H4"
    />
  </svg>
);

/**
 * Chat bubble icon for empty state
 * 空状态的聊天气泡图标
 */
const ChatBubbleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);

/**
 * Sorts sessions by updatedAt in descending order
 * 按 updatedAt 降序排序会话
 *
 * @param sessions - Sessions to sort / 要排序的会话
 * @returns Sorted sessions / 排序后的会话
 *
 * @property 6 - 会话列表排序
 */
export function sortSessionsByUpdatedAt<T extends { updatedAt: number }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * SessionList component
 * 会话列表组件
 *
 * Displays a list of sessions with create, select, delete, and rename functionality.
 *
 * @param props - SessionList props / 会话列表属性
 * @returns SessionList component / 会话列表组件
 */
export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  currentSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  isLoading = false,
  className = '',
}) => {
  const { t } = useTranslation();

  /**
   * Sort sessions by updatedAt in descending order
   * 按 updatedAt 降序排序会话
   *
   * @property 6 - 会话列表排序 - Session list should be sorted by last update time in descending order
   */
  const sortedSessions = useMemo(() => {
    return sortSessionsByUpdatedAt(sessions);
  }, [sessions]);

  /**
   * Handle session selection
   * 处理会话选择
   */
  const handleSelect = useCallback(
    (sessionId: string) => {
      onSelect(sessionId);
    },
    [onSelect]
  );

  /**
   * Handle session deletion
   * 处理会话删除
   *
   * @property 5 - 会话删除后列表更新 - After session deletion, the session list should not contain the deleted session
   */
  const handleDelete = useCallback(
    (sessionId: string) => {
      onDelete(sessionId);
    },
    [onDelete]
  );

  /**
   * Handle session rename
   * 处理会话重命名
   */
  const handleRename = useCallback(
    (sessionId: string, title: string) => {
      onRename(sessionId, title);
    },
    [onRename]
  );

  /**
   * Handle create new session
   * 处理创建新会话
   */
  const handleCreate = useCallback(() => {
    onCreate();
  }, [onCreate]);

  return (
    <div
      className={`
        flex flex-col h-full
        ${className}
      `}
      role="region"
      aria-label={t('a11y.sessionList')}
    >
      {/* Header with new session button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('session.title')}
        </h2>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isLoading}
          className="
            inline-flex items-center
            px-2 py-1
            text-sm font-medium
            text-blue-600 dark:text-blue-400
            hover:bg-blue-50 dark:hover:bg-blue-900/30
            rounded-md
            focus:outline-none focus:ring-2 focus:ring-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-150
          "
          aria-label={t('session.new')}
          title={t('session.new')}
        >
          <PlusIcon className="w-4 h-4 mr-1" />
          <span>{t('session.new')}</span>
        </button>
      </div>

      {/* Session list */}
      <div
        className="flex-1 overflow-y-auto"
        role="listbox"
        aria-label={t('session.title')}
      >
        {isLoading && sortedSessions.length === 0 ? (
          /* Loading state */
          <div className="flex items-center justify-center h-32">
            <div className="flex flex-col items-center text-gray-500 dark:text-gray-400">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mb-2" />
              <span className="text-sm">{t('common.loading')}</span>
            </div>
          </div>
        ) : sortedSessions.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
            <ChatBubbleIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('session.noSessions')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              {t('session.startNew')}
            </p>
            <button
              type="button"
              onClick={handleCreate}
              className="
                inline-flex items-center
                px-3 py-1.5
                text-sm font-medium
                text-white
                bg-blue-600 hover:bg-blue-700
                dark:bg-blue-500 dark:hover:bg-blue-600
                rounded-md
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                dark:focus:ring-offset-gray-800
                transition-colors duration-150
              "
            >
              <PlusIcon className="w-4 h-4 mr-1" />
              {t('session.new')}
            </button>
          </div>
        ) : (
          /* Session items */
          <div className="p-2 space-y-1">
            {sortedSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isSelected={session.id === currentSessionId}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionList;
