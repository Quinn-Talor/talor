/**
 * MCP Settings Component
 *
 * Manages MCP (Model Context Protocol) server configurations
 * Features:
 * - Add/edit/delete MCP servers
 * - Configure command, args, environment variables
 * - Enable/disable servers
 * - View server status
 *
 * @requirements 3.2.1 - MCP Server CRUD 操作
 * @requirements 3.2.2 - MCP Server 配置持久化
 * @requirements 3.2.6 - MCP Server 连接测试
 */

import { useEffect, useState } from 'react';

/**
 * MCP Server interface
 * MCP 服务器接口
 */
interface MCPServer {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

/**
 * MCP Server form data
 * MCP 服务器表单数据
 */
interface MCPServerFormData {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  disabled: boolean;
}

/**
 * MCP Settings Component
 * MCP 设置组件
 *
 * @returns MCP settings component / MCP 设置组件
 *
 * @requirements 3.2.1 - MCP Server CRUD 操作
 * @requirements 3.2.2 - MCP Server 配置持久化
 * @requirements 3.2.6 - MCP Server 连接测试
 */
export default function MCPSettings() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);
  const [formData, setFormData] = useState<MCPServerFormData>({
    id: '',
    name: '',
    command: '',
    args: '',
    env: '',
    disabled: false,
  });
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  /**
   * Load MCP servers from backend
   * 从后端加载 MCP 服务器
   */
  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/config/mcp');
      if (!response.ok) {
        throw new Error(`Failed to load MCP servers: ${response.statusText}`);
      }
      const data = await response.json();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
      console.error('Failed to load MCP servers:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Add a new MCP server
   * 添加新 MCP 服务器
   */
  const addServer = async () => {
    try {
      setError(null);
      const serverData: Partial<MCPServer> = {
        id: formData.id,
        name: formData.name,
        command: formData.command,
        args: formData.args ? formData.args.split(',').map((s) => s.trim()) : [],
        env: formData.env ? JSON.parse(formData.env) : {},
        disabled: formData.disabled,
      };

      const response = await fetch('/api/config/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverData),
      });

      if (!response.ok) {
        throw new Error(`Failed to add MCP server: ${response.statusText}`);
      }

      await loadServers();
      setShowAddDialog(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add MCP server');
      console.error('Failed to add MCP server:', err);
    }
  };

  /**
   * Update an existing MCP server
   * 更新现有 MCP 服务器
   */
  const updateServer = async () => {
    if (!editingServer) return;

    try {
      setError(null);
      const serverData: Partial<MCPServer> = {
        name: formData.name,
        command: formData.command,
        args: formData.args ? formData.args.split(',').map((s) => s.trim()) : [],
        env: formData.env ? JSON.parse(formData.env) : {},
        disabled: formData.disabled,
      };

      const response = await fetch(`/api/config/mcp/${editingServer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update MCP server: ${response.statusText}`);
      }

      await loadServers();
      setEditingServer(null);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update MCP server');
      console.error('Failed to update MCP server:', err);
    }
  };

  /**
   * Delete an MCP server
   * 删除 MCP 服务器
   */
  const deleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this MCP server?')) {
      return;
    }

    try {
      setError(null);
      const response = await fetch(`/api/config/mcp/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete MCP server: ${response.statusText}`);
      }

      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete MCP server');
      console.error('Failed to delete MCP server:', err);
    }
  };

  /**
   * Test MCP server connection
   * 测试 MCP 服务器连接
   */
  const testConnection = async (id: string) => {
    try {
      setTestingServer(id);
      setTestResult(null);
      const response = await fetch(`/api/config/mcp/${id}/test`, {
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
      setTestingServer(null);
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
  const openEditDialog = (server: MCPServer) => {
    setFormData({
      id: server.id,
      name: server.name,
      command: server.command,
      args: server.args?.join(', ') || '',
      env: server.env ? JSON.stringify(server.env, null, 2) : '',
      disabled: server.disabled || false,
    });
    setEditingServer(server);
  };

  /**
   * Reset form
   * 重置表单
   */
  const resetForm = () => {
    setFormData({
      id: '',
      name: '',
      command: '',
      args: '',
      env: '',
      disabled: false,
    });
  };

  /**
   * Update form field
   * 更新表单字段
   */
  const updateFormField = (field: keyof MCPServerFormData, value: string | boolean) => {
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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">MCP Servers</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Manage Model Context Protocol server configurations
          </p>
        </div>
        <button
          onClick={openAddDialog}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Add Server
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

      {/* Servers List */}
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              No MCP servers configured. Add your first server to extend Talor's capabilities.
            </p>
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{server.name}</h3>
                    {server.disabled && (
                      <span className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    ID: <span className="font-mono">{server.id}</span>
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Command: <span className="font-mono">{server.command}</span>
                  </p>
                  {server.args && server.args.length > 0 && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Args: <span className="font-mono">{server.args.join(' ')}</span>
                    </p>
                  )}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => testConnection(server.id)}
                    disabled={testingServer === server.id || server.disabled}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {testingServer === server.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => openEditDialog(server)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteServer(server.id)}
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
      {(showAddDialog || editingServer) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {editingServer ? 'Edit MCP Server' : 'Add MCP Server'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Server ID
                  </label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => updateFormField('id', e.target.value)}
                    disabled={!!editingServer}
                    placeholder="e.g., filesystem, database"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateFormField('name', e.target.value)}
                    placeholder="e.g., Filesystem MCP Server"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Command
                  </label>
                  <input
                    type="text"
                    value={formData.command}
                    onChange={(e) => updateFormField('command', e.target.value)}
                    placeholder="e.g., uvx, npx, python"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Arguments (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.args}
                    onChange={(e) => updateFormField('args', e.target.value)}
                    placeholder="e.g., mcp-server-filesystem, --port, 3000"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Environment Variables (JSON)
                  </label>
                  <textarea
                    value={formData.env}
                    onChange={(e) => updateFormField('env', e.target.value)}
                    placeholder='{"KEY": "value"}'
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="disabled"
                    checked={formData.disabled}
                    onChange={(e) => updateFormField('disabled', e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="disabled" className="ml-2 text-sm text-gray-900 dark:text-white">
                    Disable this server
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => {
                    setShowAddDialog(false);
                    setEditingServer(null);
                    resetForm();
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={editingServer ? updateServer : addServer}
                  disabled={!formData.id || !formData.name || !formData.command}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                >
                  {editingServer ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
