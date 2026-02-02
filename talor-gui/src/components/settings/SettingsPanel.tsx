/**
 * SettingsPanel Component
 * 设置面板组件
 *
 * A modal panel component for managing application settings.
 * Provides tab navigation for different settings sections:
 * - General: Theme and language settings
 * - Providers: LLM provider configuration
 * - MCP Servers: MCP server management
 * - Permissions: Permission rules configuration
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Settings tab type
 * 设置标签页类型
 */
export type SettingsTab = 'general' | 'providers' | 'mcpServers' | 'permissions';

/**
 * Props for the SettingsPanel component
 * SettingsPanel 组件的属性
 */
export interface SettingsPanelProps {
  /** Whether the panel is open / 面板是否打开 */
  isOpen: boolean;
  /** Callback when the panel is closed / 面板关闭时的回调 */
  onClose: () => void;
}

/**
 * Tab configuration interface
 * 标签页配置接口
 */
interface TabConfig {
  id: SettingsTab;
  labelKey: string;
  icon: React.FC<{ className?: string }>;
}

/**
 * Settings icon component
 * 设置图标组件
 */
const SettingsIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

/**
 * Close icon component
 * 关闭图标组件
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
 * General settings icon (cog)
 * 通用设置图标（齿轮）
 */
const GeneralIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
    />
  </svg>
);

/**
 * Providers icon (cube)
 * 提供商图标（立方体）
 */
const ProvidersIcon: React.FC<{ className?: string }> = ({ className }) => (
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
 * MCP Servers icon (server)
 * MCP 服务器图标（服务器）
 */
const MCPServersIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
    />
  </svg>
);

/**
 * Permissions icon (shield)
 * 权限图标（盾牌）
 */
const PermissionsIcon: React.FC<{ className?: string }> = ({ className }) => (
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
 * Tab configurations
 * 标签页配置
 */
const tabConfigs: TabConfig[] = [
  {
    id: 'general',
    labelKey: 'settings.general',
    icon: GeneralIcon,
  },
  {
    id: 'providers',
    labelKey: 'settings.providers',
    icon: ProvidersIcon,
  },
  {
    id: 'mcpServers',
    labelKey: 'settings.mcpServers',
    icon: MCPServersIcon,
  },
  {
    id: 'permissions',
    labelKey: 'settings.permissions',
    icon: PermissionsIcon,
  },
];

/**
 * SettingsPanel component
 * 设置面板组件
 *
 * Displays a modal panel with tabbed navigation for different settings sections.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered settings panel / 渲染后的设置面板
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Handle keyboard events for dialog
   * 处理对话框的键盘事件
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  /**
   * Set up keyboard event listener and focus management
   * 设置键盘事件监听器和焦点管理
   */
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Focus the close button when panel opens
      closeButtonRef.current?.focus();
      // Prevent body scroll when panel is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  /**
   * Handle tab change
   * 处理标签页切换
   */
  const handleTabChange = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
  }, []);

  /**
   * Handle backdrop click
   * 处理背景点击
   */
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  /**
   * Render tab content based on active tab
   * 根据活动标签页渲染内容
   */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6" data-testid="settings-panel-general-content">
            <p className="text-gray-500 dark:text-gray-400">
              {t('settings.theme.description')}
            </p>
            {/* Placeholder for general settings content */}
            <div className="text-sm text-gray-400 dark:text-gray-500">
              {/* General settings will be implemented in future tasks */}
            </div>
          </div>
        );
      case 'providers':
        return (
          <div className="space-y-6" data-testid="settings-panel-providers-content">
            <p className="text-gray-500 dark:text-gray-400">
              {t('settings.provider.noProviders')}
            </p>
            {/* Placeholder for provider settings content */}
            <div className="text-sm text-gray-400 dark:text-gray-500">
              {/* Provider settings will be implemented in task 11.2 */}
            </div>
          </div>
        );
      case 'mcpServers':
        return (
          <div className="space-y-6" data-testid="settings-panel-mcp-content">
            <p className="text-gray-500 dark:text-gray-400">
              {t('settings.mcp.noServers')}
            </p>
            {/* Placeholder for MCP server settings content */}
            <div className="text-sm text-gray-400 dark:text-gray-500">
              {/* MCP server settings will be implemented in task 11.5 */}
            </div>
          </div>
        );
      case 'permissions':
        return (
          <div className="space-y-6" data-testid="settings-panel-permissions-content">
            <p className="text-gray-500 dark:text-gray-400">
              {t('permission.rules.noRules')}
            </p>
            {/* Placeholder for permission settings content */}
            <div className="text-sm text-gray-400 dark:text-gray-500">
              {/* Permission settings will be integrated from PermissionSettings component */}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

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
      aria-labelledby="settings-panel-title"
      data-testid="settings-panel-overlay"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="
          relative
          w-full max-w-4xl mx-4
          h-[80vh] max-h-[700px]
          bg-white dark:bg-gray-800
          rounded-xl shadow-2xl
          overflow-hidden
          flex flex-col
          animate-in fade-in-0 zoom-in-95
        "
        data-testid="settings-panel"
      >
        {/* Header */}
        <div
          className="
            flex items-center justify-between
            px-6 py-4
            bg-gray-50 dark:bg-gray-800/50
            border-b border-gray-200 dark:border-gray-700
          "
        >
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            <h2
              id="settings-panel-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              data-testid="settings-panel-title"
            >
              {t('settings.title')}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="
              p-1.5 rounded-lg
              text-gray-500 dark:text-gray-400
              hover:bg-gray-100 dark:hover:bg-gray-700
              focus:outline-none focus:ring-2 focus:ring-blue-500
              transition-colors duration-200
            "
            aria-label={t('a11y.closeDialog')}
            data-testid="settings-panel-close"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content area with tabs */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tab navigation sidebar */}
          <nav
            className="
              w-48 flex-shrink-0
              bg-gray-50 dark:bg-gray-900/50
              border-r border-gray-200 dark:border-gray-700
              py-4
            "
            role="tablist"
            aria-label={t('settings.title')}
            data-testid="settings-panel-tabs"
          >
            {tabConfigs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  onClick={() => handleTabChange(tab.id)}
                  className={`
                    w-full flex items-center gap-3
                    px-4 py-3
                    text-sm font-medium text-left
                    transition-colors duration-200
                    ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-r-2 border-blue-600 dark:border-blue-400'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                    }
                  `}
                  data-testid={`settings-panel-tab-${tab.id}`}
                >
                  <Icon
                    className={`
                      w-5 h-5
                      ${
                        isActive
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }
                    `}
                  />
                  <span>{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </nav>

          {/* Tab content area */}
          <div
            id={`settings-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`settings-panel-tab-${activeTab}`}
            className="
              flex-1
              p-6
              overflow-y-auto
            "
            data-testid="settings-panel-content"
          >
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default SettingsPanel;
