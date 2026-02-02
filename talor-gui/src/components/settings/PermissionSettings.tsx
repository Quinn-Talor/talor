/**
 * PermissionSettings Component
 * 权限设置组件
 *
 * A component for managing permission rules that control how the AI agent
 * handles tool execution permissions. Users can add, edit, and delete rules
 * that define automatic permission handling based on tool patterns.
 *
 * @requirements 5.5 - 允许用户配置默认权限规则
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  PermissionRule,
  PermissionAction,
  PermissionScope,
} from '../../types/permission';

/**
 * Props for the PermissionSettings component
 * PermissionSettings 组件的属性
 */
export interface PermissionSettingsProps {
  /** Current list of permission rules / 当前权限规则列表 */
  rules: PermissionRule[];
  /** Callback when rules are updated / 规则更新时的回调 */
  onRulesChange: (rules: PermissionRule[]) => void;
}

/**
 * Plus icon component for add button
 * 添加按钮的加号图标组件
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
 * Edit icon component for edit button
 * 编辑按钮的编辑图标组件
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
 * Trash icon component for delete button
 * 删除按钮的垃圾桶图标组件
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
 * Shield icon component for empty state
 * 空状态的盾牌图标组件
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
 * Close icon component for cancel button
 * 取消按钮的关闭图标组件
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
 * Check icon component for save button
 * 保存按钮的勾选图标组件
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
 * Available action options
 * 可用的操作选项
 */
const actionOptions: { value: PermissionAction; labelKey: string }[] = [
  { value: 'allow', labelKey: 'permission.rules.actionAllow' },
  { value: 'deny', labelKey: 'permission.rules.actionDeny' },
  { value: 'ask', labelKey: 'permission.rules.actionAsk' },
];

/**
 * Available scope options
 * 可用的范围选项
 */
const scopeOptions: { value: PermissionScope; labelKey: string }[] = [
  { value: 'once', labelKey: 'permission.rules.scopeOnce' },
  { value: 'session', labelKey: 'permission.rules.scopeSession' },
  { value: 'always', labelKey: 'permission.rules.scopeAlways' },
];

/**
 * Form state for adding/editing rules
 * 添加/编辑规则的表单状态
 */
interface RuleFormState {
  toolPattern: string;
  action: PermissionAction;
  scope: PermissionScope;
}

/**
 * Initial form state
 * 初始表单状态
 */
const initialFormState: RuleFormState = {
  toolPattern: '',
  action: 'ask',
  scope: 'once',
};

/**
 * PermissionSettings component
 * 权限设置组件
 *
 * Displays a list of permission rules and provides functionality to
 * add, edit, and delete rules.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered permission settings / 渲染后的权限设置
 *
 * @requirements 5.5 - 允许用户配置默认权限规则
 */
export const PermissionSettings: React.FC<PermissionSettingsProps> = ({
  rules,
  onRulesChange,
}) => {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formState, setFormState] = useState<RuleFormState>(initialFormState);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);

  /**
   * Handle form field change
   * 处理表单字段变化
   */
  const handleFormChange = useCallback(
    (field: keyof RuleFormState, value: string) => {
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  /**
   * Start adding a new rule
   * 开始添加新规则
   */
  const handleStartAdd = useCallback(() => {
    setIsAdding(true);
    setEditingIndex(null);
    setFormState(initialFormState);
    setDeleteConfirmIndex(null);
  }, []);

  /**
   * Start editing an existing rule
   * 开始编辑现有规则
   */
  const handleStartEdit = useCallback(
    (index: number) => {
      const rule = rules[index];
      setEditingIndex(index);
      setIsAdding(false);
      setFormState({
        toolPattern: rule.toolPattern,
        action: rule.action,
        scope: rule.scope,
      });
      setDeleteConfirmIndex(null);
    },
    [rules]
  );

  /**
   * Cancel adding/editing
   * 取消添加/编辑
   */
  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingIndex(null);
    setFormState(initialFormState);
  }, []);

  /**
   * Save the current form (add or update)
   * 保存当前表单（添加或更新）
   */
  const handleSave = useCallback(() => {
    if (!formState.toolPattern.trim()) {
      return;
    }

    const newRule: PermissionRule = {
      toolPattern: formState.toolPattern.trim(),
      action: formState.action,
      scope: formState.scope,
    };

    if (isAdding) {
      onRulesChange([...rules, newRule]);
    } else if (editingIndex !== null) {
      const updatedRules = [...rules];
      updatedRules[editingIndex] = newRule;
      onRulesChange(updatedRules);
    }

    setIsAdding(false);
    setEditingIndex(null);
    setFormState(initialFormState);
  }, [formState, isAdding, editingIndex, rules, onRulesChange]);

  /**
   * Show delete confirmation
   * 显示删除确认
   */
  const handleShowDeleteConfirm = useCallback((index: number) => {
    setDeleteConfirmIndex(index);
    setIsAdding(false);
    setEditingIndex(null);
  }, []);

  /**
   * Cancel delete confirmation
   * 取消删除确认
   */
  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmIndex(null);
  }, []);

  /**
   * Confirm and execute delete
   * 确认并执行删除
   */
  const handleConfirmDelete = useCallback(
    (index: number) => {
      const updatedRules = rules.filter((_, i) => i !== index);
      onRulesChange(updatedRules);
      setDeleteConfirmIndex(null);
    },
    [rules, onRulesChange]
  );

  /**
   * Get action badge color class
   * 获取操作徽章颜色类
   */
  const getActionBadgeClass = (action: PermissionAction): string => {
    switch (action) {
      case 'allow':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'deny':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'ask':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  /**
   * Get scope badge color class
   * 获取范围徽章颜色类
   */
  const getScopeBadgeClass = (scope: PermissionScope): string => {
    switch (scope) {
      case 'always':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'session':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      case 'once':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  /**
   * Render the rule form (for add/edit)
   * 渲染规则表单（用于添加/编辑）
   */
  const renderRuleForm = () => (
    <div
      className="
        p-4 mb-4
        bg-gray-50 dark:bg-gray-800/50
        border border-gray-200 dark:border-gray-700
        rounded-lg
        space-y-4
      "
      data-testid="permission-settings-form"
    >
      {/* Tool Pattern Input */}
      <div>
        <label
          htmlFor="tool-pattern-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('permission.rules.pattern')}
        </label>
        <input
          id="tool-pattern-input"
          type="text"
          value={formState.toolPattern}
          onChange={(e) => handleFormChange('toolPattern', e.target.value)}
          placeholder={t('permission.rules.patternPlaceholder')}
          className="
            w-full px-3 py-2
            bg-white dark:bg-gray-700
            border border-gray-300 dark:border-gray-600
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            placeholder-gray-400 dark:placeholder-gray-500
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            transition-colors duration-200
          "
          data-testid="permission-settings-pattern-input"
        />
      </div>

      {/* Action Select */}
      <div>
        <label
          htmlFor="action-select"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('permission.rules.action')}
        </label>
        <select
          id="action-select"
          value={formState.action}
          onChange={(e) =>
            handleFormChange('action', e.target.value as PermissionAction)
          }
          className="
            w-full px-3 py-2
            bg-white dark:bg-gray-700
            border border-gray-300 dark:border-gray-600
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            transition-colors duration-200
          "
          data-testid="permission-settings-action-select"
        >
          {actionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Scope Select */}
      <div>
        <label
          htmlFor="scope-select"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('permission.rules.scope')}
        </label>
        <select
          id="scope-select"
          value={formState.scope}
          onChange={(e) =>
            handleFormChange('scope', e.target.value as PermissionScope)
          }
          className="
            w-full px-3 py-2
            bg-white dark:bg-gray-700
            border border-gray-300 dark:border-gray-600
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            transition-colors duration-200
          "
          data-testid="permission-settings-scope-select"
        >
          {scopeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={handleCancel}
          className="
            inline-flex items-center gap-1.5
            px-3 py-1.5
            bg-white dark:bg-gray-700
            border border-gray-300 dark:border-gray-600
            rounded-lg
            text-sm font-medium text-gray-700 dark:text-gray-300
            hover:bg-gray-50 dark:hover:bg-gray-600
            focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
            dark:focus:ring-offset-gray-800
            transition-colors duration-200
          "
          data-testid="permission-settings-cancel-button"
        >
          <CloseIcon className="w-4 h-4" />
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!formState.toolPattern.trim()}
          className="
            inline-flex items-center gap-1.5
            px-3 py-1.5
            bg-blue-600 dark:bg-blue-500
            rounded-lg
            text-sm font-medium text-white
            hover:bg-blue-700 dark:hover:bg-blue-600
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            dark:focus:ring-offset-gray-800
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
          "
          data-testid="permission-settings-save-button"
        >
          <CheckIcon className="w-4 h-4" />
          {t('common.save')}
        </button>
      </div>
    </div>
  );

  /**
   * Render a single rule item
   * 渲染单个规则项
   */
  const renderRuleItem = (rule: PermissionRule, index: number) => {
    const isDeleting = deleteConfirmIndex === index;

    return (
      <div
        key={index}
        className={`
          flex items-center justify-between
          p-3
          bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700
          rounded-lg
          ${isDeleting ? 'ring-2 ring-red-500' : ''}
          transition-all duration-200
        `}
        data-testid={`permission-settings-rule-${index}`}
      >
        {isDeleting ? (
          // Delete confirmation view
          <div className="flex items-center justify-between w-full">
            <span className="text-sm text-red-600 dark:text-red-400">
              {t('session.deleteConfirm')}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="
                  px-3 py-1
                  bg-white dark:bg-gray-700
                  border border-gray-300 dark:border-gray-600
                  rounded-md
                  text-sm text-gray-700 dark:text-gray-300
                  hover:bg-gray-50 dark:hover:bg-gray-600
                  transition-colors duration-200
                "
                data-testid={`permission-settings-rule-${index}-cancel-delete`}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(index)}
                className="
                  px-3 py-1
                  bg-red-600 dark:bg-red-500
                  rounded-md
                  text-sm text-white
                  hover:bg-red-700 dark:hover:bg-red-600
                  transition-colors duration-200
                "
                data-testid={`permission-settings-rule-${index}-confirm-delete`}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        ) : (
          // Normal view
          <>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Tool Pattern */}
              <span
                className="
                  font-mono text-sm text-gray-900 dark:text-gray-100
                  truncate
                "
                title={rule.toolPattern}
                data-testid={`permission-settings-rule-${index}-pattern`}
              >
                {rule.toolPattern}
              </span>

              {/* Action Badge */}
              <span
                className={`
                  px-2 py-0.5
                  rounded-full
                  text-xs font-medium
                  ${getActionBadgeClass(rule.action)}
                `}
                data-testid={`permission-settings-rule-${index}-action`}
              >
                {t(
                  actionOptions.find((o) => o.value === rule.action)?.labelKey ||
                    ''
                )}
              </span>

              {/* Scope Badge */}
              <span
                className={`
                  px-2 py-0.5
                  rounded-full
                  text-xs font-medium
                  ${getScopeBadgeClass(rule.scope)}
                `}
                data-testid={`permission-settings-rule-${index}-scope`}
              >
                {t(
                  scopeOptions.find((o) => o.value === rule.scope)?.labelKey || ''
                )}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                onClick={() => handleStartEdit(index)}
                className="
                  p-1.5
                  rounded-md
                  text-gray-500 dark:text-gray-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  hover:text-gray-700 dark:hover:text-gray-200
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  transition-colors duration-200
                "
                aria-label={t('permission.rules.edit')}
                data-testid={`permission-settings-rule-${index}-edit`}
              >
                <EditIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleShowDeleteConfirm(index)}
                className="
                  p-1.5
                  rounded-md
                  text-gray-500 dark:text-gray-400
                  hover:bg-red-100 dark:hover:bg-red-900/30
                  hover:text-red-600 dark:hover:text-red-400
                  focus:outline-none focus:ring-2 focus:ring-red-500
                  transition-colors duration-200
                "
                aria-label={t('permission.rules.delete')}
                data-testid={`permission-settings-rule-${index}-delete`}
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  /**
   * Render empty state
   * 渲染空状态
   */
  const renderEmptyState = () => (
    <div
      className="
        flex flex-col items-center justify-center
        py-12
        text-center
      "
      data-testid="permission-settings-empty"
    >
      <ShieldIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4" />
      <p className="text-gray-500 dark:text-gray-400 mb-4">
        {t('permission.rules.noRules')}
      </p>
      <button
        type="button"
        onClick={handleStartAdd}
        className="
          inline-flex items-center gap-2
          px-4 py-2
          bg-blue-600 dark:bg-blue-500
          rounded-lg
          text-sm font-medium text-white
          hover:bg-blue-700 dark:hover:bg-blue-600
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          dark:focus:ring-offset-gray-900
          transition-colors duration-200
        "
        data-testid="permission-settings-empty-add-button"
      >
        <PlusIcon className="w-4 h-4" />
        {t('permission.rules.add')}
      </button>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="permission-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('permission.rules.title')}
        </h3>
        {rules.length > 0 && !isAdding && editingIndex === null && (
          <button
            type="button"
            onClick={handleStartAdd}
            className="
              inline-flex items-center gap-1.5
              px-3 py-1.5
              bg-blue-600 dark:bg-blue-500
              rounded-lg
              text-sm font-medium text-white
              hover:bg-blue-700 dark:hover:bg-blue-600
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
              dark:focus:ring-offset-gray-900
              transition-colors duration-200
            "
            data-testid="permission-settings-add-button"
          >
            <PlusIcon className="w-4 h-4" />
            {t('permission.rules.add')}
          </button>
        )}
      </div>

      {/* Add Form */}
      {isAdding && renderRuleForm()}

      {/* Rules List or Empty State */}
      {rules.length === 0 && !isAdding ? (
        renderEmptyState()
      ) : (
        <div className="space-y-2" data-testid="permission-settings-list">
          {rules.map((rule, index) => (
            <React.Fragment key={index}>
              {editingIndex === index ? (
                renderRuleForm()
              ) : (
                renderRuleItem(rule, index)
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default PermissionSettings;
