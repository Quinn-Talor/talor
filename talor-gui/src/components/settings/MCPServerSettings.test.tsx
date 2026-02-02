/**
 * MCPServerSettings Component Tests
 * MCP 服务器设置组件测试
 *
 * Tests for the MCPServerSettings component functionality including
 * displaying servers, adding, editing, and deleting server configurations.
 *
 * @requirements 6.3 - 提供 MCP 服务器管理界面
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MCPServerSettings } from './MCPServerSettings';
import type { MCPServerSettingsProps } from './MCPServerSettings';
import type { MCPServerConfig } from '../../types/config';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.mcp.title': 'MCP Servers',
        'settings.mcp.add': 'Add Server',
        'settings.mcp.edit': 'Edit Server',
        'settings.mcp.delete': 'Delete Server',
        'settings.mcp.name': 'Server Name',
        'settings.mcp.command': 'Command',
        'settings.mcp.commandPlaceholder': 'e.g., npx, python',
        'settings.mcp.args': 'Arguments',
        'settings.mcp.argsPlaceholder': 'e.g., -m mcp_server',
        'settings.mcp.env': 'Environment Variables',
        'settings.mcp.envPlaceholder': 'KEY=value',
        'settings.mcp.transport': 'Transport',
        'settings.mcp.transportStdio': 'Standard I/O',
        'settings.mcp.transportSse': 'Server-Sent Events',
        'settings.mcp.noServers': 'No MCP servers configured',
        'settings.mcp.addFirst': 'Add an MCP server to extend functionality',
        'session.deleteConfirm': 'Are you sure you want to delete this?',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.delete': 'Delete',
      };
      return translations[key] || key;
    },
  }),
}));


describe('MCPServerSettings', () => {
  const mockServers: MCPServerConfig[] = [
    {
      id: 'server-1',
      name: 'Test Server 1',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { NODE_ENV: 'production' },
      transport: 'stdio',
    },
    {
      id: 'server-2',
      name: 'Test Server 2',
      command: 'python',
      args: ['-m', 'mcp_server'],
      env: {},
      transport: 'sse',
    },
  ];

  const defaultProps: MCPServerSettingsProps = {
    servers: mockServers,
    onServersChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the component with title', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings')).toBeInTheDocument();
      expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    });

    it('should render server list when servers exist', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-list')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-1')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-2')).toBeInTheDocument();
    });

    it('should display server names', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByText('Test Server 1')).toBeInTheDocument();
      expect(screen.getByText('Test Server 2')).toBeInTheDocument();
    });

    it('should display server commands', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-item-server-1-command')).toHaveTextContent('npx');
      expect(screen.getByTestId('mcp-server-settings-item-server-2-command')).toHaveTextContent('python');
    });

    it('should display transport types', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-item-server-1-transport')).toHaveTextContent('Standard I/O');
      expect(screen.getByTestId('mcp-server-settings-item-server-2-transport')).toHaveTextContent('Server-Sent Events');
    });

    it('should show add button when servers exist', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-add-button')).toBeInTheDocument();
    });

    it('should display edit and delete buttons for each server', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-item-server-1-edit')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-1-delete')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-2-edit')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-2-delete')).toBeInTheDocument();
    });
  });


  describe('Empty State', () => {
    it('should render empty state when no servers exist', () => {
      render(<MCPServerSettings {...defaultProps} servers={[]} />);

      expect(screen.getByTestId('mcp-server-settings-empty')).toBeInTheDocument();
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
      expect(screen.getByText('Add an MCP server to extend functionality')).toBeInTheDocument();
    });

    it('should render add button in empty state', () => {
      render(<MCPServerSettings {...defaultProps} servers={[]} />);

      expect(screen.getByTestId('mcp-server-settings-empty-add-button')).toBeInTheDocument();
    });

    it('should not render the header add button in empty state', () => {
      render(<MCPServerSettings {...defaultProps} servers={[]} />);

      expect(screen.queryByTestId('mcp-server-settings-add-button')).not.toBeInTheDocument();
    });

    it('should show form when clicking add button in empty state', () => {
      render(<MCPServerSettings {...defaultProps} servers={[]} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));

      expect(screen.getByTestId('mcp-server-settings-form')).toBeInTheDocument();
    });
  });


  describe('Add Server', () => {
    it('should show form when clicking add button', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.getByTestId('mcp-server-settings-form')).toBeInTheDocument();
    });

    it('should hide add button when form is shown', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.queryByTestId('mcp-server-settings-add-button')).not.toBeInTheDocument();
    });

    it('should render form with all required inputs', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.getByTestId('mcp-server-settings-name-input')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-command-input')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-args-input')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-env-input')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-transport-select')).toBeInTheDocument();
    });

    it('should render save and cancel buttons in form', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.getByTestId('mcp-server-settings-save-button')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-cancel-button')).toBeInTheDocument();
    });

    it('should have save button disabled when required fields are empty', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.getByTestId('mcp-server-settings-save-button')).toBeDisabled();
    });

    it('should enable save button when name and command are entered', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'New Server' },
      });
      // Still disabled - need command too
      expect(screen.getByTestId('mcp-server-settings-save-button')).toBeDisabled();

      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'node' },
      });
      expect(screen.getByTestId('mcp-server-settings-save-button')).not.toBeDisabled();
    });


    it('should call onServersChange with new server when saving', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'New Server' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'node' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-args-input'), {
        target: { value: '--arg1 --arg2' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-env-input'), {
        target: { value: 'KEY1=value1' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      expect(onServersChange).toHaveBeenCalledTimes(1);
      const newServers = onServersChange.mock.calls[0][0];
      expect(newServers).toHaveLength(1);
      expect(newServers[0].name).toBe('New Server');
      expect(newServers[0].command).toBe('node');
      expect(newServers[0].args).toEqual(['--arg1', '--arg2']);
      expect(newServers[0].env).toEqual({ KEY1: 'value1' });
      expect(newServers[0].transport).toBe('stdio');
    });

    it('should hide form after saving', () => {
      render(<MCPServerSettings {...defaultProps} servers={[]} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'New Server' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'node' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      expect(screen.queryByTestId('mcp-server-settings-form')).not.toBeInTheDocument();
    });

    it('should hide form when clicking cancel', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-cancel-button'));

      expect(screen.queryByTestId('mcp-server-settings-form')).not.toBeInTheDocument();
    });

    it('should not call onServersChange when clicking cancel', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'New Server' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-cancel-button'));

      expect(onServersChange).not.toHaveBeenCalled();
    });


    it('should allow selecting different transport type', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-transport-select'), {
        target: { value: 'sse' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'SSE Server' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'python' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      const newServers = onServersChange.mock.calls[0][0];
      expect(newServers[0].transport).toBe('sse');
    });

    it('should trim whitespace from inputs when saving', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: '  Trimmed Server  ' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: '  node  ' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      const newServers = onServersChange.mock.calls[0][0];
      expect(newServers[0].name).toBe('Trimmed Server');
      expect(newServers[0].command).toBe('node');
    });

    it('should handle empty optional fields', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'Minimal Server' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'cmd' },
      });
      // Don't fill in optional fields
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      const newServers = onServersChange.mock.calls[0][0];
      expect(newServers[0].name).toBe('Minimal Server');
      expect(newServers[0].args).toEqual([]);
      expect(newServers[0].env).toEqual({});
    });
  });


  describe('Edit Server', () => {
    it('should show form with server values when clicking edit', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-edit'));

      expect(screen.getByTestId('mcp-server-settings-form')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-name-input')).toHaveValue('Test Server 1');
      expect(screen.getByTestId('mcp-server-settings-command-input')).toHaveValue('npx');
      expect(screen.getByTestId('mcp-server-settings-args-input')).toHaveValue('-y @modelcontextprotocol/server-filesystem');
      expect(screen.getByTestId('mcp-server-settings-env-input')).toHaveValue('NODE_ENV=production');
      expect(screen.getByTestId('mcp-server-settings-transport-select')).toHaveValue('stdio');
    });

    it('should hide the server item being edited', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-edit'));

      // The server item should be replaced by the form
      expect(screen.queryByTestId('mcp-server-settings-item-server-1-name')).not.toBeInTheDocument();
    });

    it('should call onServersChange with updated server when saving', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-edit'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'Updated Server' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      expect(onServersChange).toHaveBeenCalledTimes(1);
      const updatedServers = onServersChange.mock.calls[0][0];
      expect(updatedServers).toHaveLength(2);
      expect(updatedServers[0].name).toBe('Updated Server');
      expect(updatedServers[0].id).toBe('server-1');
      expect(updatedServers[1].name).toBe('Test Server 2');
    });

    it('should restore original server when clicking cancel', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-edit'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'Changed Name' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-cancel-button'));

      // Original server should be visible again
      expect(screen.getByTestId('mcp-server-settings-item-server-1-name')).toHaveTextContent('Test Server 1');
    });
  });


  describe('Delete Server', () => {
    it('should show delete confirmation when clicking delete', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));

      expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
    });

    it('should show confirm and cancel buttons in delete confirmation', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));

      expect(screen.getByTestId('mcp-server-settings-item-server-1-confirm-delete')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-1-cancel-delete')).toBeInTheDocument();
    });

    it('should call onServersChange without deleted server when confirming', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-confirm-delete'));

      expect(onServersChange).toHaveBeenCalledTimes(1);
      const updatedServers = onServersChange.mock.calls[0][0];
      expect(updatedServers).toHaveLength(1);
      expect(updatedServers[0].id).toBe('server-2');
    });

    it('should hide delete confirmation when clicking cancel', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-cancel-delete'));

      expect(screen.queryByText('Are you sure you want to delete this?')).not.toBeInTheDocument();
    });

    it('should not call onServersChange when canceling delete', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-cancel-delete'));

      expect(onServersChange).not.toHaveBeenCalled();
    });

    it('should only show delete confirmation for one server at a time', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-2-delete'));

      // Only server 2 should show confirmation
      expect(screen.queryByTestId('mcp-server-settings-item-server-1-confirm-delete')).not.toBeInTheDocument();
      expect(screen.getByTestId('mcp-server-settings-item-server-2-confirm-delete')).toBeInTheDocument();
    });

    it('should handle deleting the last server', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[mockServers[0]]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-confirm-delete'));

      expect(onServersChange).toHaveBeenCalledWith([]);
    });
  });


  describe('Form Validation', () => {
    it('should parse args string correctly', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'Test' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'cmd' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-args-input'), {
        target: { value: '  arg1   arg2  arg3  ' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      const newServers = onServersChange.mock.calls[0][0];
      expect(newServers[0].args).toEqual(['arg1', 'arg2', 'arg3']);
    });

    it('should parse env string correctly with multiple lines', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'Test' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'cmd' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-env-input'), {
        target: { value: 'KEY1=value1\nKEY2=value2\nKEY3=value3' },
      });
      fireEvent.click(screen.getByTestId('mcp-server-settings-save-button'));

      const newServers = onServersChange.mock.calls[0][0];
      expect(newServers[0].env).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
        KEY3: 'value3',
      });
    });

    it('should not save server with only whitespace name', () => {
      const onServersChange = vi.fn();
      render(<MCPServerSettings {...defaultProps} servers={[]} onServersChange={onServersChange} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: '   ' },
      });
      fireEvent.change(screen.getByTestId('mcp-server-settings-command-input'), {
        target: { value: 'cmd' },
      });

      // Save button should still be disabled
      expect(screen.getByTestId('mcp-server-settings-save-button')).toBeDisabled();
    });
  });


  describe('Form State Management', () => {
    it('should reset form when switching from add to edit', () => {
      render(<MCPServerSettings {...defaultProps} />);

      // Start adding
      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));
      fireEvent.change(screen.getByTestId('mcp-server-settings-name-input'), {
        target: { value: 'New Server' },
      });

      // Switch to edit
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-edit'));

      // Form should show server 1's values
      expect(screen.getByTestId('mcp-server-settings-name-input')).toHaveValue('Test Server 1');
    });

    it('should close delete confirmation when starting to add', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.queryByTestId('mcp-server-settings-item-server-1-confirm-delete')).not.toBeInTheDocument();
    });

    it('should close delete confirmation when starting to edit', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-1-delete'));
      fireEvent.click(screen.getByTestId('mcp-server-settings-item-server-2-edit'));

      expect(screen.queryByTestId('mcp-server-settings-item-server-1-confirm-delete')).not.toBeInTheDocument();
    });

    it('should use empty form values when adding new server', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.getByTestId('mcp-server-settings-name-input')).toHaveValue('');
      expect(screen.getByTestId('mcp-server-settings-command-input')).toHaveValue('');
      expect(screen.getByTestId('mcp-server-settings-args-input')).toHaveValue('');
      expect(screen.getByTestId('mcp-server-settings-env-input')).toHaveValue('');
      expect(screen.getByTestId('mcp-server-settings-transport-select')).toHaveValue('stdio');
    });
  });


  describe('Accessibility', () => {
    it('should have proper labels for form inputs', () => {
      render(<MCPServerSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('mcp-server-settings-add-button'));

      expect(screen.getByLabelText(/Server Name/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Command/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Arguments/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Environment Variables/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Transport/)).toBeInTheDocument();
    });

    it('should have aria-label on edit buttons', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-item-server-1-edit')).toHaveAttribute('aria-label', 'Edit Server');
    });

    it('should have aria-label on delete buttons', () => {
      render(<MCPServerSettings {...defaultProps} />);

      expect(screen.getByTestId('mcp-server-settings-item-server-1-delete')).toHaveAttribute('aria-label', 'Delete Server');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty servers array', () => {
      render(<MCPServerSettings {...defaultProps} servers={[]} />);

      expect(screen.getByTestId('mcp-server-settings-empty')).toBeInTheDocument();
    });

    it('should handle single server', () => {
      render(<MCPServerSettings {...defaultProps} servers={[mockServers[0]]} />);

      expect(screen.getByTestId('mcp-server-settings-item-server-1')).toBeInTheDocument();
      expect(screen.queryByTestId('mcp-server-settings-item-server-2')).not.toBeInTheDocument();
    });

    it('should handle server without env variables', () => {
      const serverWithoutEnv: MCPServerConfig = {
        id: 'no-env-server',
        name: 'No Env',
        command: 'cmd',
        args: [],
        env: {},
        transport: 'stdio',
      };
      render(<MCPServerSettings {...defaultProps} servers={[serverWithoutEnv]} />);

      expect(screen.getByTestId('mcp-server-settings-item-no-env-server')).toBeInTheDocument();
      expect(screen.getByText('No Env')).toBeInTheDocument();
    });
  });
});