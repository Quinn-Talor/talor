/**
 * MCPServerSettings Component
 * MCP 服务器设置组件
 *
 * A component for managing MCP (Model Context Protocol) server configurations.
 * Users can add, edit, and delete MCP server configurations.
 *
 * @requirements 6.3 - 提供 MCP 服务器管理界面
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MCPServerConfig, MCPTransport } from '../../types/config';

/**
 * Props for the MCPServerSettings component
 * MCPServerSettings 组件的属性
 */
export interface MCPServerSettingsProps {
  /** Current list of MCP server configurations / 当前 MCP 服务器配置列表 */
  servers: MCPServerConfig[];
  /** Callback when servers are updated / 服务器更新时的回调 */
  onServersChange: (servers: MCPServerConfig[]) => void;
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
 * Server icon component for empty state
 * 空状态的服务器图标组件
 */
const ServerIcon: React.FC<{ className?: string }> = ({ className }) => (
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
 * Form state for adding/editing MCP servers
 * 添加/编辑 MCP 服务器的表单状态
 */
interface MCPServerFormState {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  transport: MCPTransport;
}

/**
 * Initial form state
 * 初始表单状态
 */
const initialFormState: MCPServerFormState = {
  id: '',
  name: '',
  command: '',
  args: '',
  env: '',
  transport: 'stdio',
};

/**
 * Generate a unique ID for new servers
 * 为新服务器生成唯一 ID
 */
const generateId = (): string => {
  return `mcp-server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Parse args string to array
 * 将参数字符串解析为数组
 */
const parseArgs = (argsString: string): string[] => {
  if (!argsString.trim()) return [];
  return argsString.split(/\s+/).filter(Boolean);
};

/**
 * Parse env string to Record
 * 将环境变量字符串解析为 Record
 */
const parseEnv = (envString: string): Record<string, string> => {
  if (!envString.trim()) return {};
  const env: Record<string, string> = {};
  const lines = envString.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (key) {
        env[key] = value;
      }
    }
  }
  return env;
};


/**
 * Format args array to string
 * 将参数数组格式化为字符串
 */
const formatArgs = (args: string[]): string => {
  return args.join(' ');
};

/**
 * Format env Record to string
 * 将环境变量 Record 格式化为字符串
 */
const formatEnv = (env: Record<string, string>): string => {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
};

/**
 * MCPServerSettings component
 * MCP 服务器设置组件
 *
 * Displays a list of MCP servers and provides functionality to
 * add, edit, and delete server configurations.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered MCP server settings / 渲染后的 MCP 服务器设置
 *
 * @requirements 6.3 - 提供 MCP 服务器管理界面
 */
export const MCPServerSettings: React.FC<MCPServerSettingsProps> = ({
  servers,
  onServersChange,
}) => {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<MCPServerFormState>(initialFormState);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  /**
   * Handle form field change
   * 处理表单字段变化
   */
  const handleFormChange = useCallback(
    (field: keyof MCPServerFormState, value: string | MCPTransport) => {
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );


  /**
   * Start adding a new server
   * 开始添加新服务器
   */
  const handleStartAdd = useCallback(() => {
    setIsAdding(true);
    setEditingId(null);
    setFormState({ ...initialFormState, id: generateId() });
    setDeleteConfirmId(null);
  }, []);

  /**
   * Start editing an existing server
   * 开始编辑现有服务器
   */
  const handleStartEdit = useCallback((server: MCPServerConfig) => {
    setEditingId(server.id);
    setIsAdding(false);
    setFormState({
      id: server.id,
      name: server.name,
      command: server.command,
      args: formatArgs(server.args),
      env: formatEnv(server.env),
      transport: server.transport,
    });
    setDeleteConfirmId(null);
  }, []);

  /**
   * Cancel adding/editing
   * 取消添加/编辑
   */
  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingId(null);
    setFormState(initialFormState);
  }, []);

  /**
   * Save the current form (add or update)
   * 保存当前表单（添加或更新）
   */
  const handleSave = useCallback(() => {
    if (!formState.name.trim() || !formState.command.trim()) {
      return;
    }

    const newServer: MCPServerConfig = {
      id: formState.id,
      name: formState.name.trim(),
      command: formState.command.trim(),
      args: parseArgs(formState.args),
      env: parseEnv(formState.env),
      transport: formState.transport,
    };

    if (isAdding) {
      onServersChange([...servers, newServer]);
    } else if (editingId !== null) {
      const updatedServers = servers.map((server) =>
        server.id === editingId ? newServer : server
      );
      onServersChange(updatedServers);
    }

    setIsAdding(false);
    setEditingId(null);
    setFormState(initialFormState);
  }, [formState, isAdding, editingId, servers, onServersChange]);


  /**
   * Show delete confirmation
   * 显示删除确认
   */
  const handleShowDeleteConfirm = useCallback((serverId: string) => {
    setDeleteConfirmId(serverId);
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
    (serverId: string) => {
      const updatedServers = servers.filter((s) => s.id !== serverId);
      onServersChange(updatedServers);
      setDeleteConfirmId(null);
    },
    [servers, onServersChange]
  );

  /**
   * Get transport label
   * 获取传输方式标签
   */
  const getTransportLabel = (transport: MCPTransport): string => {
    return transport === 'stdio'
      ? t('settings.mcp.transportStdio')
      : t('settings.mcp.transportSse');
  };


  /**
   * Render the server form (for add/edit)
   * 渲染服务器表单（用于添加/编辑）
   */
  const renderServerForm = () => (
    <div
      className="
        p-4 mb-4
        bg-gray-50 dark:bg-gray-800/50
        border border-gray-200 dark:border-gray-700
        rounded-lg
        space-y-4
      "
      data-testid="mcp-server-settings-form"
    >
      {/* Server Name Input */}
      <div>
        <label
          htmlFor="mcp-server-name-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.mcp.name')}
          <span className="text-red-500 ml-1">*</span>
        </label>
        <input
          id="mcp-server-name-input"
          type="text"
          value={formState.name}
          onChange={(e) => handleFormChange('name', e.target.value)}
          placeholder={t('settings.mcp.name')}
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
          data-testid="mcp-server-settings-name-input"
        />
      </div>


      {/* Command Input */}
      <div>
        <label
          htmlFor="mcp-server-command-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.mcp.command')}
          <span className="text-red-500 ml-1">*</span>
        </label>
        <input
          id="mcp-server-command-input"
          type="text"
          value={formState.command}
          onChange={(e) => handleFormChange('command', e.target.value)}
          placeholder={t('settings.mcp.commandPlaceholder')}
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
          data-testid="mcp-server-settings-command-input"
        />
      </div>

      {/* Args Input */}
      <div>
        <label
          htmlFor="mcp-server-args-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.mcp.args')}
        </label>
        <input
          id="mcp-server-args-input"
          type="text"
          value={formState.args}
          onChange={(e) => handleFormChange('args', e.target.value)}
          placeholder={t('settings.mcp.argsPlaceholder')}
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
          data-testid="mcp-server-settings-args-input"
        />
      </div>


      {/* Env Input */}
      <div>
        <label
          htmlFor="mcp-server-env-input"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.mcp.env')}
        </label>
        <textarea
          id="mcp-server-env-input"
          value={formState.env}
          onChange={(e) => handleFormChange('env', e.target.value)}
          placeholder={t('settings.mcp.envPlaceholder')}
          rows={3}
          className="
            w-full px-3 py-2
            bg-white dark:bg-gray-700
            border border-gray-300 dark:border-gray-600
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            placeholder-gray-400 dark:placeholder-gray-500
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            transition-colors duration-200
            resize-none
            font-mono
          "
          data-testid="mcp-server-settings-env-input"
        />
      </div>

      {/* Transport Select */}
      <div>
        <label
          htmlFor="mcp-server-transport-select"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.mcp.transport')}
        </label>
        <select
          id="mcp-server-transport-select"
          value={formState.transport}
          onChange={(e) => handleFormChange('transport', e.target.value as MCPTransport)}
          className="
            w-full px-3 py-2
            bg-white dark:bg-gray-700
            border border-gray-300 dark:border-gray-600
            rounded-lg
            text-sm text-gray-900 dark:text-gray-100
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            transition-colors duration-200
          "
          data-testid="mcp-server-settings-transport-select"
        >
          <option value="stdio">{t('settings.mcp.transportStdio')}</option>
          <option value="sse">{t('settings.mcp.transportSse')}</option>
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
          data-testid="mcp-server-settings-cancel-button"
        >
          <CloseIcon className="w-4 h-4" />
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!formState.name.trim() || !formState.command.trim()}
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
          data-testid="mcp-server-settings-save-button"
        >
          <CheckIcon className="w-4 h-4" />
          {t('common.save')}
        </button>
      </div>
    </div>
  );


  /**
   * Render a single server item
   * 渲染单个服务器项
   */
  const renderServerItem = (server: MCPServerConfig) => {
    const isDeleting = deleteConfirmId === server.id;

    return (
      <div
        key={server.id}
        className={`
          flex items-center justify-between
          p-3
          bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700
          rounded-lg
          ${isDeleting ? 'ring-2 ring-red-500' : ''}
          transition-all duration-200
        `}
        data-testid={`mcp-server-settings-item-${server.id}`}
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
                data-testid={`mcp-server-settings-item-${server.id}-cancel-delete`}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(server.id)}
                className="
                  px-3 py-1
                  bg-red-600 dark:bg-red-500
                  rounded-md
                  text-sm text-white
                  hover:bg-red-700 dark:hover:bg-red-600
                  transition-colors duration-200
                "
                data-testid={`mcp-server-settings-item-${server.id}-confirm-delete`}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        ) : (

          // Normal view
          <>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              {/* Server Name */}
              <span
                className="
                  font-medium text-sm text-gray-900 dark:text-gray-100
                  truncate
                "
                title={server.name}
                data-testid={`mcp-server-settings-item-${server.id}-name`}
              >
                {server.name}
              </span>

              {/* Server Details */}
              <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span
                  className="font-mono truncate max-w-[200px]"
                  title={server.command}
                  data-testid={`mcp-server-settings-item-${server.id}-command`}
                >
                  {t('settings.mcp.command')}: {server.command}
                </span>
                <span
                  className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded"
                  data-testid={`mcp-server-settings-item-${server.id}-transport`}
                >
                  {getTransportLabel(server.transport)}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                onClick={() => handleStartEdit(server)}
                className="
                  p-1.5
                  rounded-md
                  text-gray-500 dark:text-gray-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  hover:text-gray-700 dark:hover:text-gray-200
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  transition-colors duration-200
                "
                aria-label={t('settings.mcp.edit')}
                data-testid={`mcp-server-settings-item-${server.id}-edit`}
              >
                <EditIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleShowDeleteConfirm(server.id)}
                className="
                  p-1.5
                  rounded-md
                  text-gray-500 dark:text-gray-400
                  hover:bg-red-100 dark:hover:bg-red-900/30
                  hover:text-red-600 dark:hover:text-red-400
                  focus:outline-none focus:ring-2 focus:ring-red-500
                  transition-colors duration-200
                "
                aria-label={t('settings.mcp.delete')}
                data-testid={`mcp-server-settings-item-${server.id}-delete`}
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
      data-testid="mcp-server-settings-empty"
    >
      <ServerIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4" />
      <p className="text-gray-500 dark:text-gray-400 mb-2">
        {t('settings.mcp.noServers')}
      </p>
      <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
        {t('settings.mcp.addFirst')}
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
        data-testid="mcp-server-settings-empty-add-button"
      >
        <PlusIcon className="w-4 h-4" />
        {t('settings.mcp.add')}
      </button>
    </div>
  );


  return (
    <div className="space-y-4" data-testid="mcp-server-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('settings.mcp.title')}
        </h3>
        {servers.length > 0 && !isAdding && editingId === null && (
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
            data-testid="mcp-server-settings-add-button"
          >
            <PlusIcon className="w-4 h-4" />
            {t('settings.mcp.add')}
          </button>
        )}
      </div>

      {/* Add Form */}
      {isAdding && renderServerForm()}

      {/* Servers List or Empty State */}
      {servers.length === 0 && !isAdding ? (
        renderEmptyState()
      ) : (
        <div className="space-y-2" data-testid="mcp-server-settings-list">
          {servers.map((server) => (
            <React.Fragment key={server.id}>
              {editingId === server.id ? (
                renderServerForm()
              ) : (
                renderServerItem(server)
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
export default MCPServerSettings;