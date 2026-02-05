/**
 * Provider Settings Component
 *
 * Manages LLM provider configurations (OpenAI, Anthropic, etc.)
 * Features:
 * - Add/edit/delete providers
 * - Configure API keys (stored in system keyring)
 * - Test connections
 * - View available models
 *
 * @requirements 3.1.1 - Provider CRUD 操作
 * @requirements 3.1.2 - API Key 加密存储
 * @requirements 3.1.3 - 连接测试
 */

import { useEffect, useState } from 'react';

/**
 * Provider interface
 * Provider 接口
 */
interface Provider {
  id: string;
  name: string;
  api_key?: string;
  api_key_ref?: string;
  base_url?: string;
  models?: string[];
}

/**
 * Provider form data
 * Provider 表单数据
 */
interface ProviderFormData {
  id: string;
  name: string;
  api_key: string;
  base_url: string;
}

/**
 * Provider Settings Component
 * Provider 设置组件
 *
 * @returns Provider settings component / Provider 设置组件
 *
 * @requirements 3.1.1 - Provider CRUD 操作
 * @requirements 3.1.2 - API Key 加密存储
 * @requirements 3.1.3 - 连接测试
 */
export default function ProviderSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>({
    id: '',
    name: '',
    api_key: '',
    base_url: '',
  });
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  /**
   * Load providers from backend
   * 从后端加载 providers
   */
  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/config/providers');
      if (!response.ok) {
        throw new Error(`Failed to load providers: ${response.statusText}`);
      }
      const data = await response.json();
      setProviders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Add a new provider
   * 添加新 provider
   */
  const addProvider = async () => {
    try {
      setError(null);
      const response = await fetch('/api/config/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(`Failed to add provider: ${response.statusText}`);
      }

      await loadProviders();
      setShowAddDialog(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider');
      console.error('Failed to add provider:', err);
    }
  };

  /**
   * Update an existing provider
   * 更新现有 provider
   */
  const updateProvider = async () => {
    if (!editingProvider) return;

    try {
      setError(null);
      const response = await fetch(`/api/config/providers/${editingProvider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update provider: ${response.statusText}`);
      }

      await loadProviders();
      setEditingProvider(null);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
      console.error('Failed to update provider:', err);
    }
  };

  /**
   * Delete a provider
   * 删除 provider
   */
  const deleteProvider = async (id: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) {
      return;
    }

    try {
      setError(null);
      const response = await fetch(`/api/config/providers/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete provider: ${response.statusText}`);
      }

      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider');
      console.error('Failed to delete provider:', err);
    }
  };

  /**
   * Test provider connection
   * 测试 provider 连接
   */
  const testConnection = async (id: string) => {
    try {
      setTestingProvider(id);
      setTestResult(null);
      const response = await fetch(`/api/config/providers/${id}/test`, {
        method: 'POST',
      });

      const result = await response.json();
      setTestResult({
        success: result.success,
        message: result.success ? 'Connection successful!' : result.error || 'Connection failed',
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTestingProvider(null);
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  /**
   * Open add dialog
   * 打开添加对话框
   */
  const openAddDialog = () => {
    resetForm();
    setShowAddDialog(true);
  };

  /**
   * Open edit dialog
   * 打开编辑对话框
   */
  const openEditDialog = (provider: Provider) => {
    setFormData({
      id: provider.id,
      name: provider.name,
      api_key: '', // Don't show existing API key
      base_url: provider.base_url || '',
    });
    setEditingProvider(provider);
  };

  /**
   * Reset form
   * 重置表单
   */
  const resetForm = () => {
    setFormData({
      id: '',
      name: '',
      api_key: '',
      base_url: '',
    });
  };

  /**
   * Update form field
   * 更新表单字段
   */
  const updateFormField = (field: keyof ProviderFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">LLM Providers</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Manage your LLM provider configurations and API keys
          </p>
        </div>
        <button
          onClick={openAddDialog}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Add Provider
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div
          className={`border rounded-lg p-4 ${
            testResult.success
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}
        >
          <p
            className={`text-sm ${
              testResult.success
                ? 'text-green-800 dark:text-green-200'
                : 'text-red-800 dark:text-red-200'
            }`}
          >
            {testResult.message}
          </p>
        </div>
      )}

      {/* Providers List */}
      <div className="space-y-3">
        {providers.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              No providers configured. Add your first provider to get started.
            </p>
          </div>
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{provider.name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    ID: <span className="font-mono">{provider.id}</span>
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    API Key:{' '}
                    {provider.api_key_ref ? (
                      <span className="text-green-600 dark:text-green-400">✓ Configured (in keyring)</span>
                    ) : provider.api_key ? (
                      <span className="text-green-600 dark:text-green-400">✓ Configured</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">✗ Not configured</span>
                    )}
                  </p>
                  {provider.base_url && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Base URL: <span className="font-mono">{provider.base_url}</span>
                    </p>
                  )}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => testConnection(provider.id)}
                    disabled={testingProvider === provider.id}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {testingProvider === provider.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => openEditDialog(provider)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteProvider(provider.id)}
                    className="px-3 py-1.5 text-sm border border-red-300 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Dialog */}
      {(showAddDialog || editingProvider) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {editingProvider ? 'Edit Provider' : 'Add Provider'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Provider ID
                  </label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => updateFormField('id', e.target.value)}
                    disabled={!!editingProvider}
                    placeholder="e.g., openai, anthropic"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Provider Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateFormField('name', e.target.value)}
                    placeholder="e.g., OpenAI, Anthropic"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={formData.api_key}
                    onChange={(e) => updateFormField('api_key', e.target.value)}
                    placeholder={editingProvider ? 'Leave empty to keep existing' : 'Enter API key'}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    API keys are stored securely in your system keyring
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Base URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.base_url}
                    onChange={(e) => updateFormField('base_url', e.target.value)}
                    placeholder="e.g., https://api.openai.com/v1"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => {
                    setShowAddDialog(false);
                    setEditingProvider(null);
                    resetForm();
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={editingProvider ? updateProvider : addProvider}
                  disabled={!formData.id || !formData.name}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                >
                  {editingProvider ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
