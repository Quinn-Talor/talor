/**
 * Settings Page - Main configuration interface
 *
 * This page provides a tabbed interface for managing:
 * - General settings (model, agent, language)
 * - LLM Providers (OpenAI, Anthropic, etc.)
 * - MCP Servers
 * - Workspace directories
 *
 * @requirements 3.4.4 - 提供 GUI 界面用于配置管理
 */

import React, { useState } from 'react';
import GeneralSettings from '../components/settings/GeneralSettings';
import MCPSettings from '../components/settings/MCPSettings';
import ProviderSettings from '../components/settings/ProviderSettings';
import WorkspaceSettings from '../components/settings/WorkspaceSettings';

/**
 * Tab type definition
 * 标签类型定义
 */
type TabId = 'general' | 'providers' | 'mcp' | 'workspace';

/**
 * Tab configuration
 * 标签配置
 */
interface Tab {
  id: TabId;
  label: string;
  component: React.ComponentType;
}

/**
 * Available tabs
 * 可用标签
 */
const tabs: Tab[] = [
  { id: 'general', label: 'General', component: GeneralSettings },
  { id: 'providers', label: 'Providers', component: ProviderSettings },
  { id: 'mcp', label: 'MCP Servers', component: MCPSettings },
  { id: 'workspace', label: 'Workspace', component: WorkspaceSettings },
];

/**
 * Settings Page Component
 * 设置页面组件
 *
 * Provides a tabbed interface for managing application configuration.
 * 提供标签式界面用于管理应用程序配置。
 *
 * @returns Settings page component / 设置页面组件
 *
 * @requirements 3.4.4 - 提供 GUI 界面用于配置管理
 */
export default function Settings() {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  // Get the active tab component
  const ActiveComponent = tabs.find((tab) => tab.id === activeTab)?.component || GeneralSettings;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Manage your Talor configuration
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-6">
          <nav className="flex space-x-8" aria-label="Settings tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'
                  }
                `}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
