/**
 * PermissionDialog Component
 * 权限对话框组件
 *
 * A modal dialog component for displaying permission requests from the AI agent.
 * Shows tool name, arguments, description, and provides approve/deny actions
 * with scope selection (once/session/always).
 *
 * @requirements 5.1 - 显示权限请求详情
 * @requirements 5.2 - 显示工具名称、参数和潜在影响
 * @requirements 5.3 - 批准权限时记录授权并允许工具执行
 * @requirements 5.4 - 拒绝权限时阻止工具执行并通知 AI
 * @requirements 5.6 - 选择"始终允许"时记住该工具的权限设置
 * @property 15 - 权限对话框显示
 * @property 16 - 权限响应处理
 * @property 17 - 权限规则持久化
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PermissionRequest, PermissionScope } from '../../types/permission';

/**
 * Props for the PermissionDialog component
 * PermissionDialog 组件的属性
 */
export interface PermissionDialogProps {
  /** The permission request to display / 要显示的权限请求 */
  request: PermissionRequest;
  /** Callback when user approves the request / 用户批准请求时的回调 */
  onApprove: (scope: PermissionScope) => void;
  /** Callback when user denies the request / 用户拒绝请求时的回调 */
  onDeny: () => void;
}

/**
 * Shield icon component for permission dialog header
 * 权限对话框标题的盾牌图标组件
 */
const ShieldIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    />
  </svg>
);

/**
 * Close icon component for dialog close button
 * 对话框关闭按钮的关闭图标组件
 */
const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
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
 * Chevron down icon for dropdown
 * 下拉菜单的向下箭头图标
 */
const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

/**
 * Check icon for selected scope option
 * 选中范围选项的勾选图标
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
 * Scope option interface
 * 范围选项接口
 */
interface ScopeOption {
  value: PermissionScope;
  labelKey: string;
  descriptionKey: string;
}

/**
 * Available scope options
 * 可用的范围选项
 */
const scopeOptions: ScopeOption[] = [
  {
    value: 'once',
    labelKey: 'permission.allowOnce',
    descriptionKey: 'permission.scopeOnceDescription',
  },
  {
    value: 'session',
    labelKey: 'permission.allowSession',
    descriptionKey: 'permission.scopeSessionDescription',
  },
  {
    value: 'always',
    labelKey: 'permission.alwaysAllow',
    descriptionKey: 'permission.scopeAlwaysDescription',
  },
];

/**
 * Formats tool arguments for display
 * 格式化工具参数以供显示
 *
 * @param args - Tool arguments object / 工具参数对象
 * @returns Formatted string / 格式化后的字符串
 */
function formatArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * PermissionDialog component
 * 权限对话框组件
 *
 * Displays a modal dialog for permission requests with tool information
 * and approve/deny actions with scope selection.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered permission dialog / 渲染后的权限对话框
 *
 * @requirements 5.1 - 显示权限请求详情
 * @requirements 5.2 - 显示工具名称、参数和潜在影响
 * @requirements 5.3 - 批准权限时记录授权并允许工具执行
 * @requirements 5.4 - 拒绝权限时阻止工具执行并通知 AI
 * @requirements 5.6 - 选择"始终允许"时记住该工具的权限设置
 */
export const PermissionDialog: React.FC<PermissionDialogProps> = ({
  request,
  onApprove,
  onDeny,
}) => {
  const { t } = useTranslation();
  const [selectedScope, setSelectedScope] = useState<PermissionScope>('once');
  const [isScopeDropdownOpen, setIsScopeDropdownOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const approveButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Handle keyboard events for dialog
   * 处理对话框的键盘事件
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDeny();
      }
    },
    [onDeny]
  );

  /**
   * Handle click outside dropdown to close it
   * 处理点击下拉菜单外部以关闭它
   */
  const handleClickOutsideDropdown = useCallback((event: MouseEvent) => {
    if (
      dropdownRef.current &&
      !dropdownRef.current.contains(event.target as Node)
    ) {
      setIsScopeDropdownOpen(false);
    }
  }, []);

  /**
   * Set up keyboard event listener and focus trap
   * 设置键盘事件监听器和焦点陷阱
   */
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    
    // Focus the approve button when dialog opens
    approveButtonRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  /**
   * Handle click outside dropdown
   * 处理点击下拉菜单外部
   */
  useEffect(() => {
    if (isScopeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutsideDropdown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutsideDropdown);
    };
  }, [isScopeDropdownOpen, handleClickOutsideDropdown]);

  /**
   * Handle approve button click
   * 处理批准按钮点击
   */
  const handleApprove = useCallback(() => {
    onApprove(selectedScope);
  }, [onApprove, selectedScope]);

  /**
   * Handle deny button click
   * 处理拒绝按钮点击
   */
  const handleDeny = useCallback(() => {
    onDeny();
  }, [onDeny]);

  /**
   * Handle scope selection
   * 处理范围选择
   */
  const handleScopeSelect = useCallback((scope: PermissionScope) => {
    setSelectedScope(scope);
    setIsScopeDropdownOpen(false);
  }, []);

  /**
   * Toggle scope dropdown
   * 切换范围下拉菜单
   */
  const toggleScopeDropdown = useCallback(() => {
    setIsScopeDropdownOpen((prev) => !prev);
  }, []);

  /**
   * Get the label for the currently selected scope
   * 获取当前选中范围的标签
   */
  const selectedScopeOption = scopeOptions.find(
    (opt) => opt.value === selectedScope
  );

  return (
    <div
      className="
        fixed inset-0 z-50
        flex items-center justify-center
        bg-black/50 dark:bg-black/70
        backdrop-blur-sm
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-dialog-title"
      data-testid="permission-dialog-overlay"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          onDeny();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="
          relative
          w-full max-w-lg mx-4
          bg-white dark:bg-gray-800
          rounded-xl shadow-2xl
          overflow-hidden
          animate-in fade-in-0 zoom-in-95
        "
        data-testid="permission-dialog"
      >
        {/* Header */}
        <div
          className="
            flex items-center justify-between
            px-6 py-4
            bg-amber-50 dark:bg-amber-900/30
            border-b border-amber-200 dark:border-amber-800
          "
        >
          <div className="flex items-center gap-3">
            <ShieldIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            <h2
              id="permission-dialog-title"
              className="text-lg font-semibold text-amber-800 dark:text-amber-200"
              data-testid="permission-dialog-title"
            >
              {t('permission.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleDeny}
            className="
              p-1.5 rounded-lg
              text-amber-600 dark:text-amber-400
              hover:bg-amber-100 dark:hover:bg-amber-800/50
              focus:outline-none focus:ring-2 focus:ring-amber-500
              transition-colors duration-200
            "
            aria-label={t('a11y.closeDialog')}
            data-testid="permission-dialog-close"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Tool Name */}
          <div>
            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              {t('permission.toolName')}
            </label>
            <div
              className="
                px-3 py-2
                bg-gray-100 dark:bg-gray-700
                rounded-lg
                font-mono text-sm text-gray-900 dark:text-gray-100
              "
              data-testid="permission-dialog-tool-name"
            >
              {request.toolName}
            </div>
          </div>

          {/* Arguments */}
          <div>
            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              {t('permission.arguments')}
            </label>
            <pre
              className="
                px-3 py-2
                bg-gray-100 dark:bg-gray-700
                rounded-lg
                font-mono text-xs text-gray-900 dark:text-gray-100
                overflow-x-auto
                max-h-40
              "
              data-testid="permission-dialog-arguments"
            >
              {formatArguments(request.arguments)}
            </pre>
          </div>

          {/* Description */}
          {request.description && (
            <div>
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t('permission.description')}
              </label>
              <p
                className="
                  px-3 py-2
                  bg-gray-50 dark:bg-gray-700/50
                  rounded-lg
                  text-sm text-gray-700 dark:text-gray-300
                "
                data-testid="permission-dialog-description"
              >
                {request.description}
              </p>
            </div>
          )}

          {/* Scope Selection */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              {t('permission.rules.scope')}
            </label>
            <button
              type="button"
              onClick={toggleScopeDropdown}
              className="
                w-full flex items-center justify-between
                px-3 py-2
                bg-white dark:bg-gray-700
                border border-gray-300 dark:border-gray-600
                rounded-lg
                text-sm text-gray-900 dark:text-gray-100
                hover:border-gray-400 dark:hover:border-gray-500
                focus:outline-none focus:ring-2 focus:ring-blue-500
                transition-colors duration-200
              "
              aria-haspopup="listbox"
              aria-expanded={isScopeDropdownOpen}
              data-testid="permission-dialog-scope-button"
            >
              <span>
                {selectedScopeOption ? t(selectedScopeOption.labelKey) : ''}
              </span>
              <ChevronDownIcon
                className={`
                  w-4 h-4 text-gray-500 dark:text-gray-400
                  transition-transform duration-200
                  ${isScopeDropdownOpen ? 'rotate-180' : ''}
                `}
              />
            </button>

            {/* Scope Dropdown */}
            {isScopeDropdownOpen && (
              <div
                className="
                  absolute z-10 w-full mt-1
                  bg-white dark:bg-gray-800
                  border border-gray-200 dark:border-gray-700
                  rounded-lg shadow-lg
                  py-1
                  animate-in fade-in-0 zoom-in-95
                "
                role="listbox"
                data-testid="permission-dialog-scope-dropdown"
              >
                {scopeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleScopeSelect(option.value)}
                    className={`
                      w-full flex items-center justify-between
                      px-3 py-2
                      text-sm text-left
                      ${
                        selectedScope === option.value
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }
                      transition-colors duration-150
                    `}
                    role="option"
                    aria-selected={selectedScope === option.value}
                    data-testid={`permission-dialog-scope-option-${option.value}`}
                  >
                    <span>{t(option.labelKey)}</span>
                    {selectedScope === option.value && (
                      <CheckIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="
            flex items-center justify-end gap-3
            px-6 py-4
            bg-gray-50 dark:bg-gray-800/50
            border-t border-gray-200 dark:border-gray-700
          "
        >
          <button
            type="button"
            onClick={handleDeny}
            className="
              px-4 py-2
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-lg
              text-sm font-medium text-gray-700 dark:text-gray-300
              hover:bg-gray-50 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
              dark:focus:ring-offset-gray-800
              transition-colors duration-200
            "
            data-testid="permission-dialog-deny-button"
          >
            {t('permission.deny')}
          </button>
          <button
            ref={approveButtonRef}
            type="button"
            onClick={handleApprove}
            className="
              px-4 py-2
              bg-blue-600 dark:bg-blue-500
              rounded-lg
              text-sm font-medium text-white
              hover:bg-blue-700 dark:hover:bg-blue-600
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              dark:focus:ring-offset-gray-800
              transition-colors duration-200
            "
            data-testid="permission-dialog-approve-button"
          >
            {t('permission.approve')}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default PermissionDialog;
