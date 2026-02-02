/**
 * PermissionDialog Component Tests
 * 权限对话框组件测试
 *
 * Tests for the PermissionDialog component covering display of tool information,
 * approve/deny actions, scope selection, and keyboard support.
 *
 * @requirements 5.1 - 显示权限请求详情
 * @requirements 5.2 - 显示工具名称、参数和潜在影响
 * @requirements 5.3 - 批准权限时记录授权并允许工具执行
 * @requirements 5.4 - 拒绝权限时阻止工具执行并通知 AI
 * @requirements 5.6 - 选择"始终允许"时记住该工具的权限设置
 * @property 15 - 权限对话框显示
 * @property 16 - 权限响应处理
 * @property 17 - 权限规则持久化
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionDialog } from './PermissionDialog';
import type { PermissionDialogProps } from './PermissionDialog';
import type { PermissionRequest } from '../../types/permission';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'permission.title': 'Permission Request',
        'permission.approve': 'Approve',
        'permission.deny': 'Deny',
        'permission.alwaysAllow': 'Always Allow',
        'permission.allowOnce': 'Allow Once',
        'permission.allowSession': 'Allow for Session',
        'permission.toolName': 'Tool',
        'permission.arguments': 'Arguments',
        'permission.description': 'Description',
        'permission.rules.scope': 'Scope',
        'permission.scopeOnceDescription': 'Allow this action only once',
        'permission.scopeSessionDescription': 'Allow for the current session',
        'permission.scopeAlwaysDescription': 'Always allow this tool',
        'a11y.closeDialog': 'Close dialog',
      };
      return translations[key] || key;
    },
  }),
}));

describe('PermissionDialog', () => {
  const mockRequest: PermissionRequest = {
    id: 'req-123',
    sessionId: 'session-456',
    toolName: 'file_write',
    arguments: {
      path: '/home/user/test.txt',
      content: 'Hello, World!',
    },
    description: 'Write content to a file on the filesystem',
  };

  const defaultProps: PermissionDialogProps = {
    request: mockRequest,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering (Requirement 5.1, 5.2, Property 15)', () => {
    it('should render the dialog with overlay', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('permission-dialog')).toBeInTheDocument();
    });

    it('should display the permission request title', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-title')).toHaveTextContent(
        'Permission Request'
      );
    });

    it('should display the tool name', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-tool-name')).toHaveTextContent(
        'file_write'
      );
    });

    it('should display the tool arguments as formatted JSON', () => {
      render(<PermissionDialog {...defaultProps} />);

      const argsElement = screen.getByTestId('permission-dialog-arguments');
      expect(argsElement).toHaveTextContent('/home/user/test.txt');
      expect(argsElement).toHaveTextContent('Hello, World!');
    });

    it('should display the description when provided', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-description')).toHaveTextContent(
        'Write content to a file on the filesystem'
      );
    });

    it('should not display description section when description is empty', () => {
      const requestWithoutDescription: PermissionRequest = {
        ...mockRequest,
        description: '',
      };
      render(
        <PermissionDialog {...defaultProps} request={requestWithoutDescription} />
      );

      expect(
        screen.queryByTestId('permission-dialog-description')
      ).not.toBeInTheDocument();
    });

    it('should display approve and deny buttons', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-approve-button')).toBeInTheDocument();
      expect(screen.getByTestId('permission-dialog-deny-button')).toBeInTheDocument();
    });

    it('should display close button in header', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-close')).toBeInTheDocument();
    });

    it('should display scope selection button', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-scope-button')).toBeInTheDocument();
    });
  });

  describe('Approve Action (Requirement 5.3, Property 16)', () => {
    it('should call onApprove with default scope "once" when approve button is clicked', () => {
      const onApprove = vi.fn();
      render(<PermissionDialog {...defaultProps} onApprove={onApprove} />);

      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));

      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onApprove).toHaveBeenCalledWith('once');
    });

    it('should call onApprove with selected scope when approve button is clicked', () => {
      const onApprove = vi.fn();
      render(<PermissionDialog {...defaultProps} onApprove={onApprove} />);

      // Open scope dropdown
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      // Select "session" scope
      fireEvent.click(screen.getByTestId('permission-dialog-scope-option-session'));

      // Click approve
      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));

      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onApprove).toHaveBeenCalledWith('session');
    });

    it('should call onApprove with "always" scope for persistent permission (Requirement 5.6, Property 17)', () => {
      const onApprove = vi.fn();
      render(<PermissionDialog {...defaultProps} onApprove={onApprove} />);

      // Open scope dropdown
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      // Select "always" scope
      fireEvent.click(screen.getByTestId('permission-dialog-scope-option-always'));

      // Click approve
      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));

      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onApprove).toHaveBeenCalledWith('always');
    });
  });

  describe('Deny Action (Requirement 5.4, Property 16)', () => {
    it('should call onDeny when deny button is clicked', () => {
      const onDeny = vi.fn();
      render(<PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.click(screen.getByTestId('permission-dialog-deny-button'));

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it('should call onDeny when close button is clicked', () => {
      const onDeny = vi.fn();
      render(<PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.click(screen.getByTestId('permission-dialog-close'));

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it('should call onDeny when clicking on the overlay backdrop', () => {
      const onDeny = vi.fn();
      render(<PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.click(screen.getByTestId('permission-dialog-overlay'));

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onDeny when clicking inside the dialog', () => {
      const onDeny = vi.fn();
      render(<PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.click(screen.getByTestId('permission-dialog'));

      expect(onDeny).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard Support', () => {
    it('should call onDeny when Escape key is pressed', () => {
      const onDeny = vi.fn();
      render(<PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onDeny for other keys', () => {
      const onDeny = vi.fn();
      render(<PermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.keyDown(document, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'Tab' });
      fireEvent.keyDown(document, { key: 'Space' });

      expect(onDeny).not.toHaveBeenCalled();
    });
  });

  describe('Scope Selection', () => {
    it('should show scope dropdown when scope button is clicked', () => {
      render(<PermissionDialog {...defaultProps} />);

      // Dropdown should not be visible initially
      expect(
        screen.queryByTestId('permission-dialog-scope-dropdown')
      ).not.toBeInTheDocument();

      // Click to open dropdown
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      // Dropdown should now be visible
      expect(
        screen.getByTestId('permission-dialog-scope-dropdown')
      ).toBeInTheDocument();
    });

    it('should display all scope options in dropdown', () => {
      render(<PermissionDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      expect(
        screen.getByTestId('permission-dialog-scope-option-once')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-dialog-scope-option-session')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-dialog-scope-option-always')
      ).toBeInTheDocument();
    });

    it('should close dropdown when a scope option is selected', () => {
      render(<PermissionDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));
      expect(
        screen.getByTestId('permission-dialog-scope-dropdown')
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('permission-dialog-scope-option-session'));

      expect(
        screen.queryByTestId('permission-dialog-scope-dropdown')
      ).not.toBeInTheDocument();
    });

    it('should update scope button text when scope is selected', () => {
      render(<PermissionDialog {...defaultProps} />);

      // Initially shows "Allow Once"
      expect(screen.getByTestId('permission-dialog-scope-button')).toHaveTextContent(
        'Allow Once'
      );

      // Select "session" scope
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));
      fireEvent.click(screen.getByTestId('permission-dialog-scope-option-session'));

      // Should now show "Allow for Session"
      expect(screen.getByTestId('permission-dialog-scope-button')).toHaveTextContent(
        'Allow for Session'
      );
    });

    it('should mark selected scope option as selected', () => {
      render(<PermissionDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      // "once" should be selected by default
      expect(
        screen.getByTestId('permission-dialog-scope-option-once')
      ).toHaveAttribute('aria-selected', 'true');
      expect(
        screen.getByTestId('permission-dialog-scope-option-session')
      ).toHaveAttribute('aria-selected', 'false');
      expect(
        screen.getByTestId('permission-dialog-scope-option-always')
      ).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('Accessibility', () => {
    it('should have role="dialog" on the overlay', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-overlay')).toHaveAttribute(
        'role',
        'dialog'
      );
    });

    it('should have aria-modal="true" on the overlay', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-overlay')).toHaveAttribute(
        'aria-modal',
        'true'
      );
    });

    it('should have aria-labelledby pointing to the title', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-overlay')).toHaveAttribute(
        'aria-labelledby',
        'permission-dialog-title'
      );
    });

    it('should have aria-haspopup on scope button', () => {
      render(<PermissionDialog {...defaultProps} />);

      expect(screen.getByTestId('permission-dialog-scope-button')).toHaveAttribute(
        'aria-haspopup',
        'listbox'
      );
    });

    it('should have aria-expanded on scope button', () => {
      render(<PermissionDialog {...defaultProps} />);

      const scopeButton = screen.getByTestId('permission-dialog-scope-button');

      // Initially collapsed
      expect(scopeButton).toHaveAttribute('aria-expanded', 'false');

      // Open dropdown
      fireEvent.click(scopeButton);

      // Now expanded
      expect(scopeButton).toHaveAttribute('aria-expanded', 'true');
    });

    it('should have role="listbox" on scope dropdown', () => {
      render(<PermissionDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      expect(screen.getByTestId('permission-dialog-scope-dropdown')).toHaveAttribute(
        'role',
        'listbox'
      );
    });

    it('should have role="option" on scope options', () => {
      render(<PermissionDialog {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      expect(
        screen.getByTestId('permission-dialog-scope-option-once')
      ).toHaveAttribute('role', 'option');
      expect(
        screen.getByTestId('permission-dialog-scope-option-session')
      ).toHaveAttribute('role', 'option');
      expect(
        screen.getByTestId('permission-dialog-scope-option-always')
      ).toHaveAttribute('role', 'option');
    });
  });

  describe('Complex Arguments Display', () => {
    it('should handle nested object arguments', () => {
      const complexRequest: PermissionRequest = {
        ...mockRequest,
        arguments: {
          config: {
            nested: {
              value: 123,
            },
          },
          array: [1, 2, 3],
        },
      };
      render(<PermissionDialog {...defaultProps} request={complexRequest} />);

      const argsElement = screen.getByTestId('permission-dialog-arguments');
      expect(argsElement).toHaveTextContent('config');
      expect(argsElement).toHaveTextContent('nested');
      expect(argsElement).toHaveTextContent('123');
      expect(argsElement).toHaveTextContent('array');
    });

    it('should handle empty arguments object', () => {
      const emptyArgsRequest: PermissionRequest = {
        ...mockRequest,
        arguments: {},
      };
      render(<PermissionDialog {...defaultProps} request={emptyArgsRequest} />);

      const argsElement = screen.getByTestId('permission-dialog-arguments');
      expect(argsElement).toHaveTextContent('{}');
    });

    it('should handle arguments with special characters', () => {
      const specialRequest: PermissionRequest = {
        ...mockRequest,
        arguments: {
          path: '/path/with spaces/and"quotes',
          content: 'Line1\nLine2\tTabbed',
        },
      };
      render(<PermissionDialog {...defaultProps} request={specialRequest} />);

      const argsElement = screen.getByTestId('permission-dialog-arguments');
      expect(argsElement).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle rapid approve/deny clicks', () => {
      const onApprove = vi.fn();
      const onDeny = vi.fn();
      render(
        <PermissionDialog
          {...defaultProps}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      );

      // Rapid clicks on approve
      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));
      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));
      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));

      // Each click should trigger the callback
      expect(onApprove).toHaveBeenCalledTimes(3);
    });

    it('should maintain scope selection across dropdown open/close', () => {
      const onApprove = vi.fn();
      render(<PermissionDialog {...defaultProps} onApprove={onApprove} />);

      // Select "always" scope
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));
      fireEvent.click(screen.getByTestId('permission-dialog-scope-option-always'));

      // Open dropdown again
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      // "always" should still be selected
      expect(
        screen.getByTestId('permission-dialog-scope-option-always')
      ).toHaveAttribute('aria-selected', 'true');

      // Close dropdown without selecting
      fireEvent.click(screen.getByTestId('permission-dialog-scope-button'));

      // Approve should still use "always"
      fireEvent.click(screen.getByTestId('permission-dialog-approve-button'));
      expect(onApprove).toHaveBeenCalledWith('always');
    });
  });
});
