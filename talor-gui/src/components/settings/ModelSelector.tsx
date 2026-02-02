/**
 * ModelSelector Component
 * 模型选择组件
 *
 * A component for selecting LLM models from available providers.
 * Models are grouped by provider and display name, provider name, and capabilities.
 *
 * @requirements 7.1 - 显示所有可用的 LLM 模型列表
 * @requirements 7.2 - 按提供商分组显示模型
 * @requirements 7.3 - 用户选择模型时更新当前会话使用的模型
 * @requirements 7.4 - 显示模型的基本信息（名称、提供商、能力）
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelInfo } from '../../types/config';

/**
 * Props for the ModelSelector component
 * ModelSelector 组件的属性
 */
export interface ModelSelectorProps {
  /** List of available models / 可用模型列表 */
  models: ModelInfo[];
  /** Currently selected model ID / 当前选中的模型 ID */
  selectedModel?: string;
  /** Callback when a model is selected / 选择模型时的回调 */
  onSelect: (modelId: string) => void;
}

/**
 * Check icon component for selected model
 * 选中模型的勾选图标组件
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
 * Chip icon component for capabilities
 * 能力标签的芯片图标组件
 */
const ChipIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
    />
  </svg>
);

/**
 * Group models by provider
 * 按提供商分组模型
 *
 * @param models - List of models to group / 要分组的模型列表
 * @returns Models grouped by provider / 按提供商分组的模型
 */
function groupModelsByProvider(models: ModelInfo[]): Map<string, ModelInfo[]> {
  const groups = new Map<string, ModelInfo[]>();

  for (const model of models) {
    const key = model.providerId;
    const existing = groups.get(key) || [];
    existing.push(model);
    groups.set(key, existing);
  }

  return groups;
}

/**
 * ModelSelector component
 * 模型选择组件
 *
 * Displays a list of available LLM models grouped by provider.
 * Users can select a model to use for their session.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered model selector / 渲染后的模型选择器
 *
 * @requirements 7.1 - 显示所有可用的 LLM 模型列表
 * @requirements 7.2 - 按提供商分组显示模型
 * @requirements 7.3 - 用户选择模型时更新当前会话使用的模型
 * @requirements 7.4 - 显示模型的基本信息（名称、提供商、能力）
 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onSelect,
}) => {
  const { t } = useTranslation();

  /**
   * Group models by provider for display
   * 按提供商分组模型用于显示
   */
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);

  /**
   * Handle model selection
   * 处理模型选择
   */
  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
    },
    [onSelect]
  );

  /**
   * Handle keyboard selection
   * 处理键盘选择
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, modelId: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSelect(modelId);
      }
    },
    [handleSelect]
  );

  /**
   * Render a single model item
   * 渲染单个模型项
   */
  const renderModelItem = (model: ModelInfo) => {
    const isSelected = selectedModel === model.id;

    return (
      <div
        key={model.id}
        role="option"
        aria-selected={isSelected}
        tabIndex={0}
        onClick={() => handleSelect(model.id)}
        onKeyDown={(e) => handleKeyDown(e, model.id)}
        className={`
          flex items-start justify-between
          p-3
          rounded-lg
          cursor-pointer
          transition-all duration-200
          ${
            isSelected
              ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500 dark:border-blue-400'
              : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }
        `}
        data-testid={`model-selector-item-${model.id}`}
      >
        <div className="flex-1 min-w-0">
          {/* Model Name */}
          <div className="flex items-center gap-2">
            <span
              className={`
                font-medium text-sm
                ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}
              `}
              data-testid={`model-selector-item-${model.id}-name`}
            >
              {model.name}
            </span>
            {isSelected && (
              <span data-testid={`model-selector-item-${model.id}-check`}>
                <CheckIcon
                  className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0"
                />
              </span>
            )}
          </div>

          {/* Capabilities */}
          {model.capabilities.length > 0 && (
            <div
              className="flex flex-wrap gap-1 mt-2"
              data-testid={`model-selector-item-${model.id}-capabilities`}
            >
              {model.capabilities.map((capability) => (
                <span
                  key={capability}
                  className={`
                    inline-flex items-center gap-1
                    px-2 py-0.5
                    text-xs font-medium
                    rounded-full
                    ${
                      isSelected
                        ? 'bg-blue-100 dark:bg-blue-800/50 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }
                  `}
                  data-testid={`model-selector-item-${model.id}-capability-${capability}`}
                >
                  {capability}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  /**
   * Render a provider group
   * 渲染提供商分组
   */
  const renderProviderGroup = (providerId: string, providerModels: ModelInfo[]) => {
    // Get provider name from first model in group
    const providerName = providerModels[0]?.providerName || providerId;

    return (
      <div
        key={providerId}
        className="space-y-2"
        data-testid={`model-selector-group-${providerId}`}
      >
        {/* Provider Header */}
        <div className="flex items-center gap-2 px-1">
          <ChipIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          <h4
            className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide"
            data-testid={`model-selector-group-${providerId}-name`}
          >
            {providerName}
          </h4>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            ({providerModels.length})
          </span>
        </div>

        {/* Models in this group */}
        <div
          className="space-y-2 pl-6"
          role="listbox"
          aria-label={t('model.select')}
        >
          {providerModels.map(renderModelItem)}
        </div>
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
      data-testid="model-selector-empty"
    >
      <CubeIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4" />
      <p className="text-gray-500 dark:text-gray-400 mb-2">
        {t('model.noModels')}
      </p>
      <p className="text-sm text-gray-400 dark:text-gray-500">
        {t('settings.provider.addFirst')}
      </p>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="model-selector">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('model.select')}
        </h3>
        {selectedModel && (
          <span
            className="text-sm text-gray-500 dark:text-gray-400"
            data-testid="model-selector-current"
          >
            {t('model.current')}: {models.find((m) => m.id === selectedModel)?.name || selectedModel}
          </span>
        )}
      </div>

      {/* Model List or Empty State */}
      {models.length === 0 ? (
        renderEmptyState()
      ) : (
        <div className="space-y-6" data-testid="model-selector-list">
          {Array.from(groupedModels.entries()).map(([providerId, providerModels]) =>
            renderProviderGroup(providerId, providerModels)
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default ModelSelector;
