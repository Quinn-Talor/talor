/**
 * ToolStatusPanel Component Tests
 * 工具状态面板组件测试
 *
 * Tests for the ToolStatusPanel component functionality including
 * displaying MCP servers, their tools, built-in skills, and connection status.
 *
 * @requirements 8.1 - 显示所有已连接的 MCP 服务器
 * @requirements 8.2 - 显示每个服务器提供的工具列表
 * @requirements 8.3 - MCP 服务器连接状态变化时实时更新显示
 * @requirements 8.4 - 显示内置技能提供的工具
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolStatusPanel } from './ToolStatusPanel';
import type { ToolStatusPanelProps } from './ToolStatusPanel';
import type { MCPServerInfo, Tool } from '../../types/config';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      const translations: Record<string, string> = {
        'tools.title': 'Tools',
        'tools.mcpServers': 'MCP Servers',
        'tools.builtinSkills': 'Built-in Skills',
        'tools.noTools': 'No tools available',
        'tools.toolCount': `${options?.count ?? 0} tools`,
        'tools.toolCount_one': '1 tool',
        'tools.toolCount_other': `${options?.count ?? 0} tools`,
        'tools.serverStatus': 'Server Status',
        'tools.refresh': 'Refresh',
        'tools.refreshing': 'Refreshing...',
        'settings.mcp.status.connected': 'Connected',
        'settings.mcp.status.disconnected': 'Disconnected',
        'settings.mcp.status.connecting': 'Connecting...',
        'settings.mcp.status.error': 'Error',
        'settings.mcp.reconnect': 'Reconnect',
      };
      return translations[key] || key;
    },
  }),
}));

describe('ToolStatusPanel', () => {
  const mockServers: MCPServerInfo[] = [
    {
      id: 'server-1',
      name: 'Filesystem Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {},
      transport: 'stdio',
      status: 'connected',
    },
    {
      id: 'server-2',
      name: 'Database Server',
      command: 'python',
      args: ['-m', 'mcp_server_db'],
      env: {},
      transport: 'sse',
      status: 'disconnected',
    },
    {
      id: 'server-3',
      name: 'Error Server',
      command: 'node',
      args: ['server.js'],
      env: {},
      transport: 'stdio',
      status: 'error',
      error: 'Connection refused',
    },
  ];

  const mockBuiltinTools: Tool[] = [
    {
      name: 'read_file',
      description: 'Read contents of a file',
      inputSchema: { type: 'object' },
      serverId: 'builtin',
    },
    {
      name: 'write_file',
      description: 'Write contents to a file',
      inputSchema: { type: 'object' },
      serverId: 'builtin',
    },
    {
      name: 'execute_command',
      description: 'Execute a shell command',
      inputSchema: { type: 'object' },
      serverId: 'builtin',
    },
  ];

  const defaultProps: ToolStatusPanelProps = {
    servers: mockServers,
    builtinTools: mockBuiltinTools,
    onReconnect: vi.fn(),
    onRefresh: vi.fn(),
    isRefreshing: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the component with title', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('tool-status-panel')).toBeInTheDocument();
      expect(screen.getByText('Tools')).toBeInTheDocument();
    });

    it('should render MCP servers section when servers exist', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('mcp-servers-section')).toBeInTheDocument();
      expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    });

    it('should render all server items', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('server-item-server-1')).toBeInTheDocument();
      expect(screen.getByTestId('server-item-server-2')).toBeInTheDocument();
      expect(screen.getByTestId('server-item-server-3')).toBeInTheDocument();
    });

    it('should display server names', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByText('Filesystem Server')).toBeInTheDocument();
      expect(screen.getByText('Database Server')).toBeInTheDocument();
      expect(screen.getByText('Error Server')).toBeInTheDocument();
    });

    it('should render built-in skills section when builtin tools exist', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('builtin-skills-section')).toBeInTheDocument();
      expect(screen.getByText('Built-in Skills')).toBeInTheDocument();
    });

    it('should display builtin tools count badge', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('builtin-skills-count')).toHaveTextContent('3 tools');
    });

    it('should render refresh button when onRefresh is provided', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('tool-status-panel-refresh')).toBeInTheDocument();
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });

    it('should not render refresh button when onRefresh is not provided', () => {
      render(<ToolStatusPanel {...defaultProps} onRefresh={undefined} />);

      expect(screen.queryByTestId('tool-status-panel-refresh')).not.toBeInTheDocument();
    });
  });

  describe('Connection Status Display', () => {
    it('should display connected status for connected servers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const statusElement = screen.getByTestId('server-item-server-1-status');
      expect(statusElement).toHaveTextContent('Connected');
    });

    it('should display disconnected status for disconnected servers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const statusElement = screen.getByTestId('server-item-server-2-status');
      expect(statusElement).toHaveTextContent('Disconnected');
    });

    it('should display error status for error servers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const statusElement = screen.getByTestId('server-item-server-3-status');
      expect(statusElement).toHaveTextContent('Error');
    });

    it('should display connecting status for connecting servers', () => {
      const connectingServer: MCPServerInfo = {
        ...mockServers[0],
        id: 'connecting-server',
        name: 'Connecting Server',
        status: 'connecting',
      };
      render(<ToolStatusPanel {...defaultProps} servers={[connectingServer]} />);

      const statusElement = screen.getByTestId('server-item-connecting-server-status');
      expect(statusElement).toHaveTextContent('Connecting...');
    });

    it('should render status indicator for each server', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const statusIndicators = screen.getAllByTestId('status-indicator');
      expect(statusIndicators.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Reconnect Functionality', () => {
    it('should show reconnect button for disconnected servers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('server-item-server-2-reconnect')).toBeInTheDocument();
    });

    it('should show reconnect button for error servers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('server-item-server-3-reconnect')).toBeInTheDocument();
    });

    it('should not show reconnect button for connected servers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.queryByTestId('server-item-server-1-reconnect')).not.toBeInTheDocument();
    });

    it('should call onReconnect when reconnect button is clicked', () => {
      const onReconnect = vi.fn();
      render(<ToolStatusPanel {...defaultProps} onReconnect={onReconnect} />);

      fireEvent.click(screen.getByTestId('server-item-server-2-reconnect'));

      expect(onReconnect).toHaveBeenCalledTimes(1);
      expect(onReconnect).toHaveBeenCalledWith('server-2');
    });

    it('should not show reconnect button when onReconnect is not provided', () => {
      render(<ToolStatusPanel {...defaultProps} onReconnect={undefined} />);

      expect(screen.queryByTestId('server-item-server-2-reconnect')).not.toBeInTheDocument();
    });
  });

  describe('Server Expansion', () => {
    it('should expand server when clicking on header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('server-item-server-1-header'));

      expect(screen.getByTestId('server-item-server-1-tools')).toBeInTheDocument();
    });

    it('should collapse server when clicking on expanded header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      // Expand
      fireEvent.click(screen.getByTestId('server-item-server-1-header'));
      expect(screen.getByTestId('server-item-server-1-tools')).toBeInTheDocument();

      // Collapse
      fireEvent.click(screen.getByTestId('server-item-server-1-header'));
      expect(screen.queryByTestId('server-item-server-1-tools')).not.toBeInTheDocument();
    });

    it('should set aria-expanded correctly on server header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const header = screen.getByTestId('server-item-server-1-header');
      expect(header).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('should display error message when server has error and is expanded', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('server-item-server-3-header'));

      expect(screen.getByTestId('server-item-server-3-error')).toBeInTheDocument();
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });

    it('should allow multiple servers to be expanded simultaneously', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('server-item-server-1-header'));
      fireEvent.click(screen.getByTestId('server-item-server-2-header'));

      expect(screen.getByTestId('server-item-server-1-tools')).toBeInTheDocument();
      expect(screen.getByTestId('server-item-server-2-tools')).toBeInTheDocument();
    });
  });

  describe('Built-in Skills Expansion', () => {
    it('should expand built-in skills when clicking on header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('builtin-skills-header'));

      expect(screen.getByTestId('builtin-skills-tools')).toBeInTheDocument();
    });

    it('should collapse built-in skills when clicking on expanded header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      // Expand
      fireEvent.click(screen.getByTestId('builtin-skills-header'));
      expect(screen.getByTestId('builtin-skills-tools')).toBeInTheDocument();

      // Collapse
      fireEvent.click(screen.getByTestId('builtin-skills-header'));
      expect(screen.queryByTestId('builtin-skills-tools')).not.toBeInTheDocument();
    });

    it('should display all built-in tools when expanded', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('builtin-skills-header'));

      expect(screen.getByTestId('tool-item-read_file')).toBeInTheDocument();
      expect(screen.getByTestId('tool-item-write_file')).toBeInTheDocument();
      expect(screen.getByTestId('tool-item-execute_command')).toBeInTheDocument();
    });

    it('should display tool names and descriptions', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      fireEvent.click(screen.getByTestId('builtin-skills-header'));

      expect(screen.getByText('read_file')).toBeInTheDocument();
      expect(screen.getByText('Read contents of a file')).toBeInTheDocument();
      expect(screen.getByText('write_file')).toBeInTheDocument();
      expect(screen.getByText('Write contents to a file')).toBeInTheDocument();
    });

    it('should set aria-expanded correctly on built-in skills header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const header = screen.getByTestId('builtin-skills-header');
      expect(header).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('Refresh Functionality', () => {
    it('should call onRefresh when refresh button is clicked', () => {
      const onRefresh = vi.fn();
      render(<ToolStatusPanel {...defaultProps} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTestId('tool-status-panel-refresh'));

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('should show refreshing text when isRefreshing is true', () => {
      render(<ToolStatusPanel {...defaultProps} isRefreshing={true} />);

      expect(screen.getByText('Refreshing...')).toBeInTheDocument();
    });

    it('should disable refresh button when isRefreshing is true', () => {
      render(<ToolStatusPanel {...defaultProps} isRefreshing={true} />);

      expect(screen.getByTestId('tool-status-panel-refresh')).toBeDisabled();
    });

    it('should not disable refresh button when isRefreshing is false', () => {
      render(<ToolStatusPanel {...defaultProps} isRefreshing={false} />);

      expect(screen.getByTestId('tool-status-panel-refresh')).not.toBeDisabled();
    });
  });

  describe('Empty State', () => {
    it('should render empty state when no servers and no builtin tools', () => {
      render(<ToolStatusPanel {...defaultProps} servers={[]} builtinTools={[]} />);

      expect(screen.getByTestId('tool-status-panel-empty')).toBeInTheDocument();
      expect(screen.getByText('No tools available')).toBeInTheDocument();
    });

    it('should not render MCP servers section when no servers', () => {
      render(<ToolStatusPanel {...defaultProps} servers={[]} />);

      expect(screen.queryByTestId('mcp-servers-section')).not.toBeInTheDocument();
    });

    it('should not render built-in skills section when no builtin tools', () => {
      render(<ToolStatusPanel {...defaultProps} builtinTools={[]} />);

      expect(screen.queryByTestId('builtin-skills-section')).not.toBeInTheDocument();
    });

    it('should render only servers section when only servers exist', () => {
      render(<ToolStatusPanel {...defaultProps} builtinTools={[]} />);

      expect(screen.getByTestId('mcp-servers-section')).toBeInTheDocument();
      expect(screen.queryByTestId('builtin-skills-section')).not.toBeInTheDocument();
    });

    it('should render only built-in skills section when only builtin tools exist', () => {
      render(<ToolStatusPanel {...defaultProps} servers={[]} />);

      expect(screen.queryByTestId('mcp-servers-section')).not.toBeInTheDocument();
      expect(screen.getByTestId('builtin-skills-section')).toBeInTheDocument();
    });
  });

  describe('Single Server', () => {
    it('should handle single server correctly', () => {
      render(<ToolStatusPanel {...defaultProps} servers={[mockServers[0]]} />);

      expect(screen.getByTestId('server-item-server-1')).toBeInTheDocument();
      expect(screen.queryByTestId('server-item-server-2')).not.toBeInTheDocument();
    });
  });

  describe('Single Built-in Tool', () => {
    it('should handle single built-in tool correctly', () => {
      render(<ToolStatusPanel {...defaultProps} builtinTools={[mockBuiltinTools[0]]} />);

      expect(screen.getByTestId('builtin-skills-count')).toHaveTextContent('1 tools');
    });
  });

  describe('Accessibility', () => {
    it('should have proper aria-label on refresh button', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('tool-status-panel-refresh')).toHaveAttribute(
        'aria-label',
        'Refresh'
      );
    });

    it('should have proper aria-expanded on server headers', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      const headers = [
        screen.getByTestId('server-item-server-1-header'),
        screen.getByTestId('server-item-server-2-header'),
        screen.getByTestId('server-item-server-3-header'),
      ];

      headers.forEach((header) => {
        expect(header).toHaveAttribute('aria-expanded');
      });
    });

    it('should have proper aria-expanded on built-in skills header', () => {
      render(<ToolStatusPanel {...defaultProps} />);

      expect(screen.getByTestId('builtin-skills-header')).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle server without error message when status is error', () => {
      const serverWithoutError: MCPServerInfo = {
        ...mockServers[2],
        error: undefined,
      };
      render(<ToolStatusPanel {...defaultProps} servers={[serverWithoutError]} />);

      fireEvent.click(screen.getByTestId('server-item-server-3-header'));

      expect(screen.queryByTestId('server-item-server-3-error')).not.toBeInTheDocument();
    });

    it('should handle tool without description', () => {
      const toolWithoutDescription: Tool = {
        name: 'no_description_tool',
        description: '',
        inputSchema: {},
        serverId: 'builtin',
      };
      render(<ToolStatusPanel {...defaultProps} builtinTools={[toolWithoutDescription]} />);

      fireEvent.click(screen.getByTestId('builtin-skills-header'));

      expect(screen.getByTestId('tool-item-no_description_tool')).toBeInTheDocument();
      expect(screen.getByText('no_description_tool')).toBeInTheDocument();
    });

    it('should handle empty servers array', () => {
      render(<ToolStatusPanel {...defaultProps} servers={[]} />);

      expect(screen.queryByTestId('mcp-servers-section')).not.toBeInTheDocument();
    });

    it('should handle undefined builtinTools', () => {
      render(<ToolStatusPanel {...defaultProps} builtinTools={undefined} />);

      expect(screen.queryByTestId('builtin-skills-section')).not.toBeInTheDocument();
    });

    it('should not propagate click event when clicking reconnect button', () => {
      const onReconnect = vi.fn();
      render(<ToolStatusPanel {...defaultProps} onReconnect={onReconnect} />);

      // Server should not expand when clicking reconnect
      fireEvent.click(screen.getByTestId('server-item-server-2-reconnect'));

      expect(onReconnect).toHaveBeenCalled();
      expect(screen.queryByTestId('server-item-server-2-tools')).not.toBeInTheDocument();
    });
  });
});
