/**
 * SettingsPage Component
 * 设置页面组件
 *
 * A full-page settings view that integrates all settings components:
 * - General settings (theme, language)
 * - Provider settings (LLM providers)
 * - Model selector
 * - MCP server settings
 * - Permission settings
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore, type Theme, type Language } from '../store/settings';
import {
  ProviderSettings,
  ModelSelector,
  MCPServerSettings,
  PermissionSettings,
} from '../components/settings';
import type { ProviderConfig, MCPServerConfig, ModelInfo } from '../types/config';
import type { PermissionRule } from '../types/permission';

/**
 * Settings tab type
 * 设置标签页类型
 */
export type SettingsTab = 'general' | 'providers' | 'models' | 'mcpServers' | 'permissions';

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
 * Back arrow icon component
 * 返回箭头图标组件
 */
const BackIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    />
  </svg>
);

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
 * Models icon (chip)
 * 模型图标（芯片）
 */
const ModelsIcon: React.FC<{ className?: string }> = ({ className }) => (
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
 * Sun icon component for light theme
 * 浅色主题的太阳图标组件
 */
const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

/**
 * Moon icon component for dark theme
 * 深色主题的月亮图标组件
 */
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
    />
  </svg>
);

/**
 * Computer/System icon component for system theme
 * 系统主题的电脑图标组件
 */
const SystemIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
    />
  </svg>
);

/**
 * Check icon component for selected item
 * 选中项的勾选图标组件
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
    id: 'models',
    labelKey: 'model.title',
    icon: ModelsIcon,
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
 * Theme option interface
 * 主题选项接口
 */
interface ThemeOption {
  value: Theme;
  labelKey: string;
  icon: React.FC<{ className?: string }>;
}

/**
 * Available theme options
 * 可用的主题选项
 */
const themeOptions: ThemeOption[] = [
  { value: 'light', labelKey: 'settings.theme.light', icon: SunIcon },
  { value: 'dark', labelKey: 'settings.theme.dark', icon: MoonIcon },
  { value: 'system', labelKey: 'settings.theme.system', icon: SystemIcon },
];

/**
 * Language option interface
 * 语言选项接口
 */
interface LanguageOption {
  value: Language;
  labelKey: string;
  native: string;
}

/**
 * Available language options
 * 可用的语言选项
 */
const languageOptions: LanguageOption[] = [
  { value: 'en', labelKey: 'settings.language.en', native: 'English' },
  { value: 'zh', labelKey: 'settings.language.zh', native: '中文' },
];

/**
 * SettingsPage component
 * 设置页面组件
 *
 * Displays a full-page settings view with tabbed navigation for different settings sections.
 *
 * @returns Rendered settings page / 渲染后的设置页面
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */
export const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Settings store state and actions
  const {
    theme,
    language,
    defaultModel,
    providers,
    mcpServers,
    setTheme,
    setLanguage,
    setDefaultModel,
    addProvider,
    updateProvider,
    removeProvider,
    addMCPServer,
    updateMCPServer,
    removeMCPServer,
  } = useSettingsStore();

  // Local state for permission rules (would typically come from a store)
  const [permissionRules, setPermissionRules] = useState<PermissionRule[]>([]);

  // Mock models list (would typically come from API)
  const [models] = useState<ModelInfo[]>(() => {
    // Generate mock models based on providers
    const mockModels: ModelInfo[] = [];
    // Safely handle case where providers might be undefined
    if (providers && Array.isArray(providers)) {
      providers.forEach((provider) => {
        mockModels.push({
          id: `${provider.id}-default`,
          name: `${provider.name} Default Model`,
          providerId: provider.id,
          providerName: provider.name,
          capabilities: ['chat', 'completion'],
        });
      });
    }
    return mockModels;
  });

  /**
   * Handle tab change
   * 处理标签页切换
   */
  const handleTabChange = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
  }, []);

  /**
   * Handle back navigation
   * 处理返回导航
   */
  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  /**
   * Handle theme change
   * 处理主题变化
   */
  const handleThemeChange = useCallback(
    (newTheme: Theme) => {
      setTheme(newTheme);
    },
    [setTheme]
  );

  /**
   * Handle language change
   * 处理语言变化
   */
  const handleLanguageChange = useCallback(
    (newLanguage: Language) => {
      setLanguage(newLanguage);
      i18n.changeLanguage(newLanguage);
    },
    [setLanguage, i18n]
  );

  /**
   * Handle providers change
   * 处理提供商变化
   */
  const handleProvidersChange = useCallback(
    (newProviders: ProviderConfig[]) => {
      // Find added providers
      const existingIds = new Set(providers.map((p) => p.id));
      const newIds = new Set(newProviders.map((p) => p.id));

      // Add new providers
      newProviders.forEach((provider) => {
        if (!existingIds.has(provider.id)) {
          addProvider(provider);
        } else {
          // Update existing provider
          updateProvider(provider.id, provider);
        }
      });

      // Remove deleted providers
      providers.forEach((provider) => {
        if (!newIds.has(provider.id)) {
          removeProvider(provider.id);
        }
      });
    },
    [providers, addProvider, updateProvider, removeProvider]
  );

  /**
   * Handle model selection
   * 处理模型选择
   */
  const handleModelSelect = useCallback(
    (modelId: string) => {
      setDefaultModel(modelId);
    },
    [setDefaultModel]
  );

  /**
   * Handle MCP servers change
   * 处理 MCP 服务器变化
   */
  const handleMCPServersChange = useCallback(
    (newServers: MCPServerConfig[]) => {
      // Find added servers
      const existingIds = new Set(mcpServers.map((s) => s.id));
      const newIds = new Set(newServers.map((s) => s.id));

      // Add new servers
      newServers.forEach((server) => {
        if (!existingIds.has(server.id)) {
          addMCPServer(server);
        } else {
          // Update existing server
          updateMCPServer(server.id, server);
        }
      });

      // Remove deleted servers
      mcpServers.forEach((server) => {
        if (!newIds.has(server.id)) {
          removeMCPServer(server.id);
        }
      });
    },
    [mcpServers, addMCPServer, updateMCPServer, removeMCPServer]
  );

  /**
   * Handle permission rules change
   * 处理权限规则变化
   */
  const handlePermissionRulesChange = useCallback((newRules: PermissionRule[]) => {
    setPermissionRules(newRules);
  }, []);

  /**
   * Render general settings content
   * 渲染通用设置内容
   */
  const renderGeneralSettings = () => (
    <div className="space-y-8" data-testid="settings-page-general-content">
      {/* Theme Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('settings.theme.title')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('settings.theme.description')}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleThemeChange(option.value)}
                className={`
                  flex flex-col items-center justify-center
                  p-4
                  rounded-lg
                  border-2
                  transition-all duration-200
                  ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
                data-testid={`settings-page-theme-${option.value}`}
              >
                <Icon
                  className={`
                    w-8 h-8 mb-2
                    ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}
                  `}
                />
                <span
                  className={`
                    text-sm font-medium
                    ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}
                  `}
                >
                  {t(option.labelKey)}
                </span>
                {isSelected && (
                  <CheckIcon className="w-4 h-4 mt-1 text-blue-600 dark:text-blue-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Language Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('settings.language.title')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('settings.language.description')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {languageOptions.map((option) => {
            const isSelected = language === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleLanguageChange(option.value)}
                className={`
                  flex items-center justify-between
                  p-4
                  rounded-lg
                  border-2
                  transition-all duration-200
                  ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
                data-testid={`settings-page-language-${option.value}`}
              >
                <div className="flex flex-col items-start">
                  <span
                    className={`
                      text-sm font-medium
                      ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}
                    `}
                  >
                    {option.native}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t(option.labelKey)}
                  </span>
                </div>
                {isSelected && (
                  <CheckIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  /**
   * Render tab content based on active tab
   * 根据活动标签页渲染内容
   */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return renderGeneralSettings();
      case 'providers':
        return (
          <div data-testid="settings-page-providers-content">
            <ProviderSettings
              providers={providers}
              onProvidersChange={handleProvidersChange}
            />
          </div>
        );
      case 'models':
        return (
          <div data-testid="settings-page-models-content">
            <ModelSelector
              models={models}
              selectedModel={defaultModel ?? undefined}
              onSelect={handleModelSelect}
            />
          </div>
        );
      case 'mcpServers':
        return (
          <div data-testid="settings-page-mcp-content">
            <MCPServerSettings
              servers={mcpServers}
              onServersChange={handleMCPServersChange}
            />
          </div>
        );
      case 'permissions':
        return (
          <div data-testid="settings-page-permissions-content">
            <PermissionSettings
              rules={permissionRules}
              onRulesChange={handlePermissionRulesChange}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-gray-50 dark:bg-gray-900"
      data-testid="settings-page"
    >
      {/* Header */}
      <header
        className="
          flex items-center
          px-6 py-4
          bg-white dark:bg-gray-800
          border-b border-gray-200 dark:border-gray-700
        "
      >
        <button
          type="button"
          onClick={handleBack}
          className="
            p-2 mr-4
            rounded-lg
            text-gray-500 dark:text-gray-400
            hover:bg-gray-100 dark:hover:bg-gray-700
            focus:outline-none focus:ring-2 focus:ring-blue-500
            transition-colors duration-200
          "
          aria-label={t('common.back')}
          data-testid="settings-page-back-button"
        >
          <BackIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          <h1
            className="text-xl font-semibold text-gray-900 dark:text-gray-100"
            data-testid="settings-page-title"
          >
            {t('settings.title')}
          </h1>
        </div>
      </header>

      {/* Content area with tabs */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab navigation sidebar */}
        <nav
          className="
            w-56 flex-shrink-0
            bg-white dark:bg-gray-800
            border-r border-gray-200 dark:border-gray-700
            py-4
            overflow-y-auto
          "
          role="tablist"
          aria-label={t('settings.title')}
          data-testid="settings-page-tabs"
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
                aria-controls={`settings-page-${tab.id}`}
                onClick={() => handleTabChange(tab.id)}
                className={`
                  w-full flex items-center gap-3
                  px-4 py-3
                  text-sm font-medium text-left
                  transition-colors duration-200
                  ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-r-2 border-blue-600 dark:border-blue-400'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
                  }
                `}
                data-testid={`settings-page-tab-${tab.id}`}
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
        <main
          id={`settings-page-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`settings-page-tab-${activeTab}`}
          className="
            flex-1
            p-6
            overflow-y-auto
            bg-gray-50 dark:bg-gray-900
          "
          data-testid="settings-page-content"
        >
          <div className="max-w-3xl">
            {renderTabContent()}
          </div>
        </main>
      </div>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default SettingsPage;
