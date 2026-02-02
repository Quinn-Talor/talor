/**
 * ProviderSettings Component
 * 提供商设置组件
 *
 * A component for managing LLM provider configurations including
 * API keys and base URLs. Users can add, edit, and delete providers.
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderConfig } from '../../types/config';

/**
 * Props for the ProviderSettings component
 * ProviderSettings 组件的属性
 */
export interface ProviderSettingsProps {
  /** Current list of provider configurations / 当前提供商配置列表 */
  providers: ProviderConfig[];
  /** Callback when providers are updated / 提供商更新时的回调 */
  onProvidersChange: (providers: ProviderConfig[]) => void;
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
 * Cube icon component for empty state
 * 空状态的立方体图标组件
 */
const CubeIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
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
 * Eye icon component for show password
 * 显示密码的眼睛图标组件
 */
const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
    />
  </svg>
);


/**
 * Eye off icon component for hide password
 * 隐藏密码的眼睛关闭图标组件
 */
const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
    />
  </svg>
);

/**
 * Form state for adding/editing providers
 * 添加/编辑提供商的表单状态
 */
interface ProviderFormState {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

/**
 * Initial form state
 * 初始表单状态
 */
const initialFormState: ProviderFormState = {
  id: '',
  name: '',
  apiKey: '',
  baseUrl: '',
  defaultModel: '',
};

/**
 * Generate a unique ID for new providers
 * 为新提供商生成唯一 ID
 */
const generateId = (): string => {
  return `provider-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};


/**
 * ProviderSettings component
 * 提供商设置组件
 *
 * Displays a list of LLM providers and provides functionality to
 * add, edit, and delete provider configurations.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered provider settings / 渲染后的提供商设置
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */
export const ProviderSettings: React.FC<ProviderSettingsProps> = ({
  providers,
  onProvidersChange,
}) => {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<ProviderFormState>(initialFormState);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  /**
   * Handle form field change
   * 处理表单字段变化
   */
  const handleFormChange = useCallback(
    (field: keyof ProviderFormState, value: string) => {
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  /**
   * Start adding a new provider
   * 开始添加新提供商
   */
  const handleStartAdd = useCallback(() => {
    setIsAdding(true);
    setEditingId(null);
    setFormState({ ...initialFormState, id: generateId() });
    setDeleteConfirmId(null);
    setShowApiKey(false);
  }, []);

  /**
   * Start editing an existing provider
   * 开始编辑现有提供商
   */
  const handleStartEdit = useCallback(
    (provider: ProviderConfig) => {
      setEditingId(provider.id);
      setIsAdding(false);
      setFormState({
        id: provider.id,
        name: provider.name,
        apiKey: provider.apiKey || '',
        baseUrl: provider.baseUrl || '',
        defaultModel: provider.defaultModel || '',
      });
      setDeleteConfirmId(null);
      setShowApiKey(false);
    },
    []
  );


  /**
   * Cancel adding/editing
   * 取消添加/编辑
   */
  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingId(null);
    setFormState(initialFormState);
    setShowApiKey(false);
  }, []);

  /**
   * Save the current form (add or update)
   * 保存当前表单（添加或更新）
   */
  const handleSave = useCallback(() => {
    if (!formState.name.trim()) {
      return;
    }

    const newProvider: ProviderConfig = {
      id: formState.id,
      name: formState.name.trim(),
      apiKey: formState.apiKey.trim() || undefined,
      baseUrl: formState.baseUrl.trim() || undefined,
      defaultModel: formState.defaultModel.trim() || undefined,
    };

    if (isAdding) {
      onProvidersChange([...providers, newProvider]);
    } else if (editingId !== null) {
      const updatedProviders = providers.map((provider) =>
        provider.id === editingId ? newProvider : provider
      );
      onProvidersChange(updatedProviders);
    }

    setIsAdding(false);
    setEditingId(null);
    setFormState(initialFormState);
    setShowApiKey(false);
  }, [formState, isAdding, editingId, providers, onProvidersChange]);

  /**
   * Show delete confirmation
   * 显示删除确认
   */
  const handleShowDeleteConfirm = useCallback((providerId: string) => {
    setDeleteConfirmId(providerId);
    setIsAdding(false);
    setEditingId(null);
  }, []);

  /**
   * Cancel delete confirmation
   * 取消删除确认
   */
  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  /**
   * Confirm and execute delete
   * 确认并执行删除
   */
  const handleConfirmDelete = useCallback(
    (providerId: string) => {
      const updatedProviders = providers.filter((p) => p.id !== providerId);
      onProvidersChange(updatedProviders);
      setDeleteConfirmId(null);
    },
    [providers, onProvidersChange]
  );

  /**
   * Toggle API key visibility
   * 切换 API 密钥可见性
   */
  const handleToggleApiKeyVisibility = useCallback(() => {
    setShowApiKey((prev) => !prev);
  }, []);


  /**
   * Mask API key for display
   * 遮蔽 API 密钥用于显示
   */
  const maskApiKey = (apiKey: string): string => {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return '••••••••';
    return `${apiKey.slice(0, 4)}${'•'.repeat(Math.min(apiKey.length - 8, 16))}${apiKey.slice(-4)}`;
  };

  /**
   * Render the provider form (for add/edit)
   * 渲染提供商表单（用于添加/编辑）
   */
  const renderProviderForm = () => (
    <div
      className="
        p-4 mb-4
        bg-gray-50 dark:bg-gray-800/50
        border border-gray-200 dark:border-gray-700
        rounded-lg
        space-y-4
      "
      data-testid="provider-settings-form"
    >
      {/* Provider Name Input */}
      <div>
        <label
          htmlFor="provider-name-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.provider.name')}
          <span className="text-red-500 ml-1">*</span>
        </label>
        <input
          id="provider-name-input"
          type="text"
          value={formState.name}
          onChange={(e) => handleFormChange('name', e.target.value)}
          placeholder={t('settings.provider.name')}
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
          data-testid="provider-settings-name-input"
        />
      </div>


      {/* API Key Input */}
      <div>
        <label
          htmlFor="provider-apikey-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.provider.apiKey')}
        </label>
        <div className="relative">
          <input
            id="provider-apikey-input"
            type={showApiKey ? 'text' : 'password'}
            value={formState.apiKey}
            onChange={(e) => handleFormChange('apiKey', e.target.value)}
            placeholder={t('settings.provider.apiKeyPlaceholder')}
            className="
              w-full px-3 py-2 pr-10
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-lg
              text-sm text-gray-900 dark:text-gray-100
              placeholder-gray-400 dark:placeholder-gray-500
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              transition-colors duration-200
            "
            data-testid="provider-settings-apikey-input"
          />
          <button
            type="button"
            onClick={handleToggleApiKeyVisibility}
            className="
              absolute right-2 top-1/2 -translate-y-1/2
              p-1
              text-gray-500 dark:text-gray-400
              hover:text-gray-700 dark:hover:text-gray-200
              focus:outline-none focus:ring-2 focus:ring-blue-500 rounded
              transition-colors duration-200
            "
            aria-label={showApiKey ? t('common.hide') : t('common.show')}
            data-testid="provider-settings-apikey-toggle"
          >
            {showApiKey ? (
              <EyeOffIcon className="w-4 h-4" />
            ) : (
              <EyeIcon className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>


      {/* Base URL Input */}
      <div>
        <label
          htmlFor="provider-baseurl-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.provider.baseUrl')}
        </label>
        <input
          id="provider-baseurl-input"
          type="text"
          value={formState.baseUrl}
          onChange={(e) => handleFormChange('baseUrl', e.target.value)}
          placeholder={t('settings.provider.baseUrlPlaceholder')}
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
          data-testid="provider-settings-baseurl-input"
        />
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
          data-testid="provider-settings-cancel-button"
        >
          <CloseIcon className="w-4 h-4" />
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!formState.name.trim()}
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
          data-testid="provider-settings-save-button"
        >
          <CheckIcon className="w-4 h-4" />
          {t('common.save')}
        </button>
      </div>
    </div>
  );


  /**
   * Render a single provider item
   * 渲染单个提供商项
   */
  const renderProviderItem = (provider: ProviderConfig) => {
    const isDeleting = deleteConfirmId === provider.id;

    return (
      <div
        key={provider.id}
        className={`
          flex items-center justify-between
          p-3
          bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700
          rounded-lg
          ${isDeleting ? 'ring-2 ring-red-500' : ''}
          transition-all duration-200
        `}
        data-testid={`provider-settings-item-${provider.id}`}
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
                data-testid={`provider-settings-item-${provider.id}-cancel-delete`}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(provider.id)}
                className="
                  px-3 py-1
                  bg-red-600 dark:bg-red-500
                  rounded-md
                  text-sm text-white
                  hover:bg-red-700 dark:hover:bg-red-600
                  transition-colors duration-200
                "
                data-testid={`provider-settings-item-${provider.id}-confirm-delete`}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        ) : (
          // Normal view
          <>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              {/* Provider Name */}
              <span
                className="
                  font-medium text-sm text-gray-900 dark:text-gray-100
                  truncate
                "
                title={provider.name}
                data-testid={`provider-settings-item-${provider.id}-name`}
              >
                {provider.name}
              </span>


              {/* Provider Details */}
              <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                {provider.apiKey && (
                  <span
                    className="font-mono"
                    data-testid={`provider-settings-item-${provider.id}-apikey`}
                  >
                    {t('settings.provider.apiKey')}: {maskApiKey(provider.apiKey)}
                  </span>
                )}
                {provider.baseUrl && (
                  <span
                    className="truncate max-w-[200px]"
                    title={provider.baseUrl}
                    data-testid={`provider-settings-item-${provider.id}-baseurl`}
                  >
                    {t('settings.provider.baseUrl')}: {provider.baseUrl}
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                onClick={() => handleStartEdit(provider)}
                className="
                  p-1.5
                  rounded-md
                  text-gray-500 dark:text-gray-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  hover:text-gray-700 dark:hover:text-gray-200
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  transition-colors duration-200
                "
                aria-label={t('settings.provider.edit')}
                data-testid={`provider-settings-item-${provider.id}-edit`}
              >
                <EditIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleShowDeleteConfirm(provider.id)}
                className="
                  p-1.5
                  rounded-md
                  text-gray-500 dark:text-gray-400
                  hover:bg-red-100 dark:hover:bg-red-900/30
                  hover:text-red-600 dark:hover:text-red-400
                  focus:outline-none focus:ring-2 focus:ring-red-500
                  transition-colors duration-200
                "
                aria-label={t('settings.provider.delete')}
                data-testid={`provider-settings-item-${provider.id}-delete`}
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
      data-testid="provider-settings-empty"
    >
      <CubeIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4" />
      <p className="text-gray-500 dark:text-gray-400 mb-2">
        {t('settings.provider.noProviders')}
      </p>
      <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
        {t('settings.provider.addFirst')}
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
        data-testid="provider-settings-empty-add-button"
      >
        <PlusIcon className="w-4 h-4" />
        {t('settings.provider.add')}
      </button>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="provider-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('settings.provider.title')}
        </h3>
        {providers.length > 0 && !isAdding && editingId === null && (
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
            data-testid="provider-settings-add-button"
          >
            <PlusIcon className="w-4 h-4" />
            {t('settings.provider.add')}
          </button>
        )}
      </div>

      {/* Add Form */}
      {isAdding && renderProviderForm()}

      {/* Providers List or Empty State */}
      {providers.length === 0 && !isAdding ? (
        renderEmptyState()
      ) : (
        <div className="space-y-2" data-testid="provider-settings-list">
          {providers.map((provider) => (
            <React.Fragment key={provider.id}>
              {editingId === provider.id ? (
                renderProviderForm()
              ) : (
                renderProviderItem(provider)
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
export default ProviderSettings;