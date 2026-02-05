/**
 * General Settings Component
 *
 * Manages general application settings
 * Features:
 * - Default model selection
 * - Default agent selection
 * - Language preferences
 * - Theme settings
 *
 * @requirements 3.4.3 - 默认模型和 Agent 选择
 * @requirements 3.4.4 - 提供 GUI 界面用于配置管理
 */

import { useEffect, useState } from 'react';

/**
 * Configuration interface
 * 配置接口
 */
interface Config {
  default_model?: string;
  default_agent?: string;
  language?: string;
  theme?: string;
}

/**
 * General Settings Component
 * 通用设置组件
 *
 * @returns General settings component / 通用设置组件
 *
 * @requirements 3.4.3 - 默认模型和 Agent 选择
 * @requirements 3.4.4 - 提供 GUI 界面用于配置管理
 */
export default function GeneralSettings() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /**
   * Load configuration from backend
   * 从后端加载配置
   */
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.statusText}`);
      }
      const data = await response.json();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Save configuration to backend
   * 保存配置到后端
   */
  const saveConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error(`Failed to save config: ${response.statusText}`);
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Update a config field
   * 更新配置字段
   */
  const updateField = (field: keyof Config, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">General Settings</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Configure default model, agent, and application preferences
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-sm text-green-800 dark:text-green-200">Settings saved successfully!</p>
        </div>
      )}

      {/* Settings Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {/* Default Model */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
            Default Model
          </label>
          <input
            type="text"
            value={config.default_model || ''}
            onChange={(e) => updateField('default_model', e.target.value)}
            placeholder="e.g., openai/gpt-4o"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Format: provider/model (e.g., openai/gpt-4o, anthropic/claude-3-5-sonnet-20241022)
          </p>
        </div>

        {/* Default Agent */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
            Default Agent
          </label>
          <select
            value={config.default_agent || 'build'}
            onChange={(e) => updateField('default_agent', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="build">Build (Executor)</option>
            <option value="plan">Plan (Planner)</option>
            <option value="explore">Explore (Explorer)</option>
            <option value="general">General (Research)</option>
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Choose the default agent for new sessions
          </p>
        </div>

        {/* Language */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
            Language
          </label>
          <select
            value={config.language || 'en'}
            onChange={(e) => updateField('language', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Application interface language
          </p>
        </div>

        {/* Theme */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
            Theme
          </label>
          <select
            value={config.theme || 'system'}
            onChange={(e) => updateField('theme', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Choose your preferred color theme
          </p>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
