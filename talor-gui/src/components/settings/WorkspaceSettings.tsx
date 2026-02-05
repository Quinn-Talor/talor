/**
 * Workspace Settings Component
 *
 * Manages workspace directory configurations
 * Features:
 * - Add/remove workspace directories
 * - View current workspace restrictions
 * - File picker integration (Electron)
 *
 * Security: Talor can only access files within configured workspace directories
 *
 * @requirements 4.1 - 工作目录配置
 * @requirements 4.6 - GUI 配置界面
 * @requirements 4.7 - 文件选择对话框
 */

import { useEffect, useState } from 'react';

/**
 * Workspace Settings Component
 * 工作目录设置组件
 *
 * @returns Workspace settings component / 工作目录设置组件
 *
 * @requirements 4.1 - 工作目录配置
 * @requirements 4.6 - GUI 配置界面
 * @requirements 4.7 - 文件选择对话框
 */
export default function WorkspaceSettings() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /**
   * Load workspaces from backend
   * 从后端加载工作目录
   */
  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/config/workspace');
      if (!response.ok) {
        throw new Error(`Failed to load workspaces: ${response.statusText}`);
      }
      const data = await response.json();
      setWorkspaces(data.directories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
      console.error('Failed to load workspaces:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Add a workspace directory
   * 添加工作目录
   */
  const addWorkspace = async () => {
    try {
      setAdding(true);
      setError(null);

      // Check if running in Electron
      const electronAPI = (window as any).electronAPI;
      let path: string | null = null;

      if (electronAPI && electronAPI.selectWorkspace) {
        // Use Electron file picker
        path = await electronAPI.selectWorkspace();
      } else {
        // Fallback: prompt for path (web mode)
        path = prompt('Enter workspace directory path:');
      }

      if (!path) {
        return; // User cancelled
      }

      const response = await fetch('/api/config/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to add workspace: ${response.statusText}`);
      }

      await loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add workspace');
      console.error('Failed to add workspace:', err);
    } finally {
      setAdding(false);
    }
  };

  /**
   * Remove a workspace directory
   * 移除工作目录
   */
  const removeWorkspace = async (index: number) => {
    if (!confirm(`Remove workspace: ${workspaces[index]}?`)) {
      return;
    }

    try {
      setError(null);
      const response = await fetch(`/api/config/workspace/${index}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to remove workspace: ${response.statusText}`);
      }

      await loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove workspace');
      console.error('Failed to remove workspace:', err);
    }
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
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Workspace Directories</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Talor can only access files within these directories
          </p>
          <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>Security:</strong> When workspace restrictions are enabled, Talor cannot access files outside
              these directories. Leave empty to allow access to all files.
            </p>
          </div>
        </div>
        <button
          onClick={addWorkspace}
          disabled={adding}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 whitespace-nowrap"
        >
          {adding ? 'Adding...' : 'Add Directory'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Workspaces List */}
      <div className="space-y-2">
        {workspaces.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="text-gray-500 dark:text-gray-400">
              <p className="font-medium mb-2">No workspace directories configured</p>
              <p className="text-sm">
                All file paths are accessible. Add directories to restrict file access for security.
              </p>
            </div>
          </div>
        ) : (
          workspaces.map((workspace, index) => (
            <div
              key={index}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex justify-between items-center"
            >
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <svg
                  className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span className="font-mono text-sm text-gray-900 dark:text-white truncate" title={workspace}>
                  {workspace}
                </span>
              </div>
              <button
                onClick={() => removeWorkspace(index)}
                className="ml-4 px-3 py-1.5 text-sm border border-red-300 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg transition-colors flex-shrink-0"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">How it works</h3>
        <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
          <li>• All file operations (read, write, edit) are restricted to these directories</li>
          <li>• Bash commands run with the first workspace as the default working directory</li>
          <li>• Symbolic links and relative paths (../) are validated</li>
          <li>• Changes take effect immediately without restart</li>
        </ul>
      </div>
    </div>
  );
}
