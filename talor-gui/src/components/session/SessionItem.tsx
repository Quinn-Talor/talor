/**
 * SessionItem Component
 * 会话项组件
 *
 * Individual session item component for the session list.
 * Displays session title, timestamps, and provides actions for
 * selection, deletion, and renaming.
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 2.2 - 选择现有会话加载消息历史
 * @requirements 2.3 - 删除会话并从列表中移除
 * @requirements 2.4 - 显示会话的标题、创建时间和最后更新时间
 * @requirements 2.6 - 重命名会话并持久化
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionInfo } from '../../types/session';

/**
 * SessionItem props interface
 * 会话项属性接口
 */
export interface SessionItemProps {
  /** Session information / 会话信息 */
  session: SessionInfo;
  /** Whether this session is currently selected / 是否为当前选中的会话 */
  isSelected?: boolean;
  /** Callback when session is selected / 选择会话时的回调 */
  onSelect: (sessionId: string) => void;
  /** Callback when session is deleted / 删除会话时的回调 */
  onDelete: (sessionId: string) => void;
  /** Callback when session is renamed / 重命名会话时的回调 */
  onRename: (sessionId: string, title: string) => void;
}

/**
 * Trash icon component
 * 删除图标组件
 */
const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);

/**
 * Edit/Pencil icon component
 * 编辑图标组件
 */
const EditIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    />
  </svg>
);

/**
 * Check icon component for confirm
 * 确认图标组件
 */
const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M5 13l4 4L19 7"
    />
  </svg>
);

/**
 * X icon component for cancel
 * 取消图标组件
 */
const XIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);


/**
 * Format timestamp to relative time string
 * 将时间戳格式化为相对时间字符串
 *
 * @param timestamp - Unix timestamp in milliseconds / Unix 时间戳（毫秒）
 * @param t - Translation function / 翻译函数
 * @returns Formatted relative time string / 格式化的相对时间字符串
 */
export function formatRelativeTime(
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {
    return t('time.now');
  } else if (minutes < 60) {
    return t('time.minutesAgo', { count: minutes });
  } else if (hours < 24) {
    return t('time.hoursAgo', { count: hours });
  } else if (days < 7) {
    return t('time.daysAgo', { count: days });
  } else {
    // Format as date for older sessions
    return new Date(timestamp).toLocaleDateString();
  }
}

/**
 * SessionItem component
 * 会话项组件
 *
 * Displays a single session item with selection, deletion, and rename capabilities.
 *
 * @param props - SessionItem props / 会话项属性
 * @returns SessionItem component / 会话项组件
 */
export const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isSelected = false,
  onSelect,
  onDelete,
  onRename,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Focus input when entering edit mode
   * 进入编辑模式时聚焦输入框
   */
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  /**
   * Reset edit title when session changes
   * 当会话变化时重置编辑标题
   */
  useEffect(() => {
    setEditTitle(session.title);
  }, [session.title]);

  /**
   * Handle session selection
   * 处理会话选择
   */
  const handleSelect = useCallback(() => {
    if (!isEditing && !showDeleteConfirm) {
      onSelect(session.id);
    }
  }, [isEditing, showDeleteConfirm, onSelect, session.id]);

  /**
   * Handle edit button click
   * 处理编辑按钮点击
   */
  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsEditing(true);
      setEditTitle(session.title);
    },
    [session.title]
  );

  /**
   * Handle rename confirmation
   * 处理重命名确认
   */
  const handleRenameConfirm = useCallback(() => {
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle && trimmedTitle !== session.title) {
      onRename(session.id, trimmedTitle);
    }
    setIsEditing(false);
  }, [editTitle, session.id, session.title, onRename]);

  /**
   * Handle rename cancel
   * 处理重命名取消
   */
  const handleRenameCancel = useCallback(() => {
    setIsEditing(false);
    setEditTitle(session.title);
  }, [session.title]);

  /**
   * Handle keyboard events in edit mode
   * 处理编辑模式下的键盘事件
   */
  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRenameCancel();
      }
    },
    [handleRenameConfirm, handleRenameCancel]
  );

  /**
   * Handle delete button click
   * 处理删除按钮点击
   */
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  }, []);

  /**
   * Handle delete confirmation
   * 处理删除确认
   */
  const handleDeleteConfirm = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(session.id);
      setShowDeleteConfirm(false);
    },
    [onDelete, session.id]
  );

  /**
   * Handle delete cancel
   * 处理删除取消
   */
  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
  }, []);

  // Get display title
  const displayTitle = session.title || t('session.untitled');

  return (
    <div
      className={`
        group relative
        flex flex-col
        px-3 py-2
        cursor-pointer
        rounded-lg
        transition-colors duration-150
        ${
          isSelected
            ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-blue-500'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 border-l-2 border-transparent'
        }
      `}
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      }}
      aria-selected={isSelected}
      aria-label={`${displayTitle}, ${t('session.messageCount', { count: session.messageCount })}`}
    >
      {/* Delete confirmation overlay */}
      {showDeleteConfirm && (
        <div
          className="
            absolute inset-0 z-10
            flex items-center justify-center
            bg-red-50 dark:bg-red-900/30
            rounded-lg
          "
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-sm text-red-600 dark:text-red-400 mr-2">
            {t('session.deleteConfirm')}
          </span>
          <button
            type="button"
            onClick={handleDeleteConfirm}
            className="
              p-1 mr-1
              rounded
              text-red-600 dark:text-red-400
              hover:bg-red-100 dark:hover:bg-red-900/50
              focus:outline-none focus:ring-2 focus:ring-red-500
            "
            aria-label={t('common.confirm')}
          >
            <CheckIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDeleteCancel}
            className="
              p-1
              rounded
              text-gray-500 dark:text-gray-400
              hover:bg-gray-200 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-gray-500
            "
            aria-label={t('common.cancel')}
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Session content */}
      <div className="flex items-start justify-between">
        {/* Title section */}
        <div className="flex-1 min-w-0 mr-2">
          {isEditing ? (
            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={handleRenameCancel}
                className="
                  flex-1 min-w-0
                  px-2 py-0.5
                  text-sm font-medium
                  bg-white dark:bg-gray-700
                  border border-blue-500
                  rounded
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  text-gray-900 dark:text-gray-100
                "
                aria-label={t('session.rename')}
              />
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleRenameConfirm();
                }}
                className="
                  p-1 ml-1
                  rounded
                  text-green-600 dark:text-green-400
                  hover:bg-green-100 dark:hover:bg-green-900/50
                  focus:outline-none focus:ring-2 focus:ring-green-500
                "
                aria-label={t('common.confirm')}
              >
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleRenameCancel();
                }}
                className="
                  p-1
                  rounded
                  text-gray-500 dark:text-gray-400
                  hover:bg-gray-200 dark:hover:bg-gray-600
                  focus:outline-none focus:ring-2 focus:ring-gray-500
                "
                aria-label={t('common.cancel')}
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <h3
              className={`
                text-sm font-medium truncate
                ${
                  isSelected
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-gray-900 dark:text-gray-100'
                }
              `}
              title={displayTitle}
            >
              {displayTitle}
            </h3>
          )}
        </div>

        {/* Action buttons (visible on hover or when selected) */}
        {!isEditing && !showDeleteConfirm && (
          <div
            className={`
              flex items-center space-x-1
              ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              transition-opacity duration-150
            `}
          >
            <button
              type="button"
              onClick={handleEditClick}
              className="
                p-1
                rounded
                text-gray-400 dark:text-gray-500
                hover:text-gray-600 dark:hover:text-gray-300
                hover:bg-gray-200 dark:hover:bg-gray-600
                focus:outline-none focus:ring-2 focus:ring-blue-500
              "
              aria-label={t('session.rename')}
              title={t('session.rename')}
            >
              <EditIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className="
                p-1
                rounded
                text-gray-400 dark:text-gray-500
                hover:text-red-600 dark:hover:text-red-400
                hover:bg-red-100 dark:hover:bg-red-900/50
                focus:outline-none focus:ring-2 focus:ring-red-500
              "
              aria-label={t('session.delete')}
              title={t('session.delete')}
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Metadata section */}
      {!isEditing && (
        <div className="mt-1 flex items-center text-xs text-gray-500 dark:text-gray-400">
          <span>{formatRelativeTime(session.updatedAt, t)}</span>
          <span className="mx-1">·</span>
          <span>{t('session.messageCount', { count: session.messageCount })}</span>
        </div>
      )}
    </div>
  );
};

export default SessionItem;
