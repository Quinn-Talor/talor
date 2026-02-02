/**
 * ToolStatusPanel Component
 * 工具状态面板组件
 *
 * A component for displaying the status of MCP servers and their tools,
 * as well as built-in skill tools.
 *
 * @requirements 8.1 - 显示所有已连接的 MCP 服务器
 * @requirements 8.2 - 显示每个服务器提供的工具列表
 * @requirements 8.3 - MCP 服务器连接状态变化时实时更新显示
 * @requirements 8.4 - 显示内置技能提供的工具
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MCPServerInfo, Tool } from '../../types/config';

/**
 * Props for the ToolStatusPanel component
 * ToolStatusPanel 组件的属性
 */
export interface ToolStatusPanelProps {
  /** List of MCP servers with their status / MCP 服务器列表及其状态 */
  servers: MCPServerInfo[];
  /** List of built-in skill tools / 内置技能工具列表 */
  builtinTools?: Tool[];
  /** Callback when reconnect is requested for a server / 请求重新连接服务器时的回调 */
  onReconnect?: (serverId: string) => void;
  /** Callback when refresh is requested / 请求刷新时的回调 */
  onRefresh?: () => void;
  /** Whether the panel is currently refreshing / 面板是否正在刷新 */
  isRefreshing?: boolean;
}

/**
 * Server icon component
 * 服务器图标组件
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
 * Tool icon component
 * 工具图标组件
 */
const ToolIcon: React.FC<{ className?: string }> = ({ className }) => (
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
 * Skill icon component for built-in skills
 * 内置技能图标组件
 */
const SkillIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M13 10V3L4 14h7v7l9-11h-7z"
    />
  </svg>
);

/**
 * Refresh icon component
 * 刷新图标组件
 */
const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

/**
 * Chevron icon component for expand/collapse
 * 展开/收起的箭头图标组件
 */
const ChevronIcon: React.FC<{ className?: string; expanded?: boolean }> = ({
  className,
  expanded,
}) => (
  <svg
    className={`${className} transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
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
      d="M9 5l7 7-7 7"
    />
  </svg>
);

/**
 * Empty state icon component
 * 空状态图标组件
 */
const EmptyIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
    />
  </svg>
);

/**
 * Connection status type
 * 连接状态类型
 */
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * Get status color classes based on connection status
 * 根据连接状态获取状态颜色类
 */
const getStatusColorClasses = (status: ConnectionStatus): string => {
  switch (status) {
    case 'connected':
      return 'bg-green-500';
    case 'disconnected':
      return 'bg-gray-400';
    case 'connecting':
      return 'bg-yellow-500 animate-pulse';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
};

/**
 * Get status text color classes based on connection status
 * 根据连接状态获取状态文本颜色类
 */
const getStatusTextColorClasses = (status: ConnectionStatus): string => {
  switch (status) {
    case 'connected':
      return 'text-green-600 dark:text-green-400';
    case 'disconnected':
      return 'text-gray-500 dark:text-gray-400';
    case 'connecting':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'error':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-gray-500 dark:text-gray-400';
  }
};

/**
 * ToolStatusPanel component
 * 工具状态面板组件
 *
 * Displays MCP servers with their connection status and tools,
 * as well as built-in skill tools.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered tool status panel / 渲染后的工具状态面板
 *
 * @requirements 8.1, 8.2, 8.3, 8.4
 */
export const ToolStatusPanel: React.FC<ToolStatusPanelProps> = ({
  servers,
  builtinTools = [],
  onReconnect,
  onRefresh,
  isRefreshing = false,
}) => {
  const { t } = useTranslation();
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [expandedBuiltinSkills, setExpandedBuiltinSkills] = useState(false);

  /**
   * Toggle server expansion
   * 切换服务器展开状态
   */
  const toggleServerExpansion = useCallback((serverId: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  }, []);

  /**
   * Toggle built-in skills expansion
   * 切换内置技能展开状态
   */
  const toggleBuiltinSkillsExpansion = useCallback(() => {
    setExpandedBuiltinSkills((prev) => !prev);
  }, []);

  /**
   * Handle reconnect button click
   * 处理重新连接按钮点击
   */
  const handleReconnect = useCallback(
    (serverId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      onReconnect?.(serverId);
    },
    [onReconnect]
  );

  /**
   * Handle refresh button click
   * 处理刷新按钮点击
   */
  const handleRefresh = useCallback(() => {
    onRefresh?.();
  }, [onRefresh]);

  /**
   * Get tools for a specific server
   * 获取特定服务器的工具
   *
   * Note: In the current implementation, tools are not directly attached to MCPServerInfo.
   * This function serves as a placeholder for future integration where tools might be
   * fetched separately or embedded in server info.
   */
  const getServerTools = useCallback(
    (_serverId: string): Tool[] => {
      // Tools would typically come from a separate API call or be embedded in server info
      // For now, return empty array as placeholder
      return [];
    },
    []
  );

  /**
   * Check if there are any servers or tools
   * 检查是否有任何服务器或工具
   */
  const hasContent = servers.length > 0 || builtinTools.length > 0;

  /**
   * Render status indicator
   * 渲染状态指示器
   */
  const renderStatusIndicator = (status: ConnectionStatus) => (
    <span
      className={`
        inline-block w-2 h-2 rounded-full
        ${getStatusColorClasses(status)}
      `}
      aria-hidden="true"
      data-testid="status-indicator"
    />
  );

  /**
   * Render a single tool item
   * 渲染单个工具项
   */
  const renderToolItem = (tool: Tool, index: number) => (
    <div
      key={`${tool.name}-${index}`}
      className="
        flex items-start gap-2
        py-2 px-3
        bg-gray-50 dark:bg-gray-800/50
        rounded-md
      "
      data-testid={`tool-item-${tool.name}`}
    >
      <ToolIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span
          className="
            block text-sm font-medium text-gray-700 dark:text-gray-300
            truncate
          "
          title={tool.name}
        >
          {tool.name}
        </span>
        {tool.description && (
          <span
            className="
              block text-xs text-gray-500 dark:text-gray-400
              line-clamp-2
            "
            title={tool.description}
          >
            {tool.description}
          </span>
        )}
      </div>
    </div>
  );

  /**
   * Render a single server item
   * 渲染单个服务器项
   */
  const renderServerItem = (server: MCPServerInfo) => {
    const isExpanded = expandedServers.has(server.id);
    const serverTools = getServerTools(server.id);
    const showReconnect = server.status === 'disconnected' || server.status === 'error';

    return (
      <div
        key={server.id}
        className="
          border border-gray-200 dark:border-gray-700
          rounded-lg
          overflow-hidden
        "
        data-testid={`server-item-${server.id}`}
      >
        {/* Server Header */}
        <div
          className="
            flex items-center justify-between
            bg-white dark:bg-gray-800
          "
        >
          <button
            type="button"
            onClick={() => toggleServerExpansion(server.id)}
            className="
              flex-1 flex items-center
              px-4 py-3
              hover:bg-gray-50 dark:hover:bg-gray-700/50
              transition-colors duration-200
              text-left
            "
            aria-expanded={isExpanded}
            data-testid={`server-item-${server.id}-header`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <ChevronIcon
                className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0"
                expanded={isExpanded}
              />
              <ServerIcon className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span
                  className="
                    block text-sm font-medium text-gray-900 dark:text-gray-100
                    truncate
                  "
                  title={server.name}
                  data-testid={`server-item-${server.id}-name`}
                >
                  {server.name}
                </span>
              </div>
            </div>

            {/* Status Badge */}
            <div
              className="flex items-center gap-1.5 ml-2"
              data-testid={`server-item-${server.id}-status`}
            >
              {renderStatusIndicator(server.status)}
              <span
                className={`
                  text-xs font-medium
                  ${getStatusTextColorClasses(server.status)}
                `}
              >
                {t(`settings.mcp.status.${server.status}`)}
              </span>
            </div>
          </button>

          {/* Reconnect Button - Outside of the header button to avoid nesting */}
          {showReconnect && onReconnect && (
            <button
              type="button"
              onClick={(e) => handleReconnect(server.id, e)}
              className="
                px-3 py-3
                text-xs font-medium
                text-blue-600 dark:text-blue-400
                hover:bg-blue-50 dark:hover:bg-blue-900/30
                transition-colors duration-200
              "
              data-testid={`server-item-${server.id}-reconnect`}
            >
              {t('settings.mcp.reconnect')}
            </button>
          )}
        </div>

        {/* Server Tools (Expanded) */}
        {isExpanded && (
          <div
            className="
              px-4 py-3
              bg-gray-50 dark:bg-gray-900/30
              border-t border-gray-200 dark:border-gray-700
            "
            data-testid={`server-item-${server.id}-tools`}
          >
            {/* Error Message */}
            {server.status === 'error' && server.error && (
              <div
                className="
                  mb-3 p-2
                  bg-red-50 dark:bg-red-900/20
                  border border-red-200 dark:border-red-800
                  rounded-md
                  text-sm text-red-600 dark:text-red-400
                "
                data-testid={`server-item-${server.id}-error`}
              >
                {server.error}
              </div>
            )}

            {/* Tools List */}
            {serverTools.length > 0 ? (
              <div className="space-y-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('tools.toolCount', { count: serverTools.length })}
                </span>
                <div className="space-y-1">
                  {serverTools.map((tool, index) => renderToolItem(tool, index))}
                </div>
              </div>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {t('tools.noTools')}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  /**
   * Render built-in skills section
   * 渲染内置技能部分
   */
  const renderBuiltinSkills = () => {
    if (builtinTools.length === 0) {
      return null;
    }

    return (
      <div
        className="
          border border-gray-200 dark:border-gray-700
          rounded-lg
          overflow-hidden
        "
        data-testid="builtin-skills-section"
      >
        {/* Built-in Skills Header */}
        <button
          type="button"
          onClick={toggleBuiltinSkillsExpansion}
          className="
            w-full flex items-center justify-between
            px-4 py-3
            bg-white dark:bg-gray-800
            hover:bg-gray-50 dark:hover:bg-gray-700/50
            transition-colors duration-200
            text-left
          "
          aria-expanded={expandedBuiltinSkills}
          data-testid="builtin-skills-header"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <ChevronIcon
              className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0"
              expanded={expandedBuiltinSkills}
            />
            <SkillIcon className="w-5 h-5 text-purple-500 dark:text-purple-400 flex-shrink-0" />
            <span
              className="
                text-sm font-medium text-gray-900 dark:text-gray-100
              "
            >
              {t('tools.builtinSkills')}
            </span>
          </div>

          {/* Tool Count Badge */}
          <span
            className="
              px-2 py-0.5
              text-xs font-medium
              text-purple-600 dark:text-purple-400
              bg-purple-50 dark:bg-purple-900/30
              rounded-full
            "
            data-testid="builtin-skills-count"
          >
            {t('tools.toolCount', { count: builtinTools.length })}
          </span>
        </button>

        {/* Built-in Tools (Expanded) */}
        {expandedBuiltinSkills && (
          <div
            className="
              px-4 py-3
              bg-gray-50 dark:bg-gray-900/30
              border-t border-gray-200 dark:border-gray-700
              space-y-1
            "
            data-testid="builtin-skills-tools"
          >
            {builtinTools.map((tool, index) => renderToolItem(tool, index))}
          </div>
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
      data-testid="tool-status-panel-empty"
    >
      <EmptyIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4" />
      <p className="text-gray-500 dark:text-gray-400 mb-2">
        {t('tools.noTools')}
      </p>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="tool-status-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('tools.title')}
        </h3>
        {onRefresh && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="
              inline-flex items-center gap-1.5
              px-3 py-1.5
              text-sm font-medium
              text-gray-600 dark:text-gray-400
              hover:text-gray-900 dark:hover:text-gray-100
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded-lg
              transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            aria-label={t('tools.refresh')}
            data-testid="tool-status-panel-refresh"
          >
            <RefreshIcon
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? t('tools.refreshing') : t('tools.refresh')}</span>
          </button>
        )}
      </div>

      {/* Content */}
      {hasContent ? (
        <div className="space-y-3">
          {/* MCP Servers Section */}
          {servers.length > 0 && (
            <div className="space-y-2" data-testid="mcp-servers-section">
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {t('tools.mcpServers')}
              </h4>
              <div className="space-y-2">
                {servers.map((server) => renderServerItem(server))}
              </div>
            </div>
          )}

          {/* Built-in Skills Section */}
          {renderBuiltinSkills()}
        </div>
      ) : (
        renderEmptyState()
      )}
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default ToolStatusPanel;
