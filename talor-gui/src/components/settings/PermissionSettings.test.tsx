/**
 * PermissionSettings Component Tests
 * 权限设置组件测试
 *
 * Tests for the PermissionSettings component covering display of permission rules,
 * add/edit/delete functionality, and empty state handling.
 *
 * @requirements 5.5 - 允许用户配置默认权限规则
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionSettings } from './PermissionSettings';
import type { PermissionSettingsProps } from './PermissionSettings';
import type { PermissionRule } from '../../types/permission';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'permission.rules.title': 'Permission Rules',
        'permission.rules.add': 'Add Rule',
        'permission.rules.edit': 'Edit Rule',
        'permission.rules.delete': 'Delete Rule',
        'permission.rules.pattern': 'Tool Pattern',
        'permission.rules.patternPlaceholder': 'e.g., file_*, read_*',
        'permission.rules.action': 'Action',
        'permission.rules.actionAllow': 'Allow',
        'permission.rules.actionDeny': 'Deny',
        'permission.rules.actionAsk': 'Ask',
        'permission.rules.scope': 'Scope',
        'permission.rules.scopeOnce': 'Once',
        'permission.rules.scopeSession': 'Session',
        'permission.rules.scopeAlways': 'Always',
        'permission.rules.noRules': 'No permission rules configured',
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
        'session.deleteConfirm': 'Are you sure you want to delete this?',
      };
      return translations[key] || key;
    },
  }),
}));

describe('PermissionSettings', () => {
  const mockRules: PermissionRule[] = [
    { toolPattern: 'file_*', action: 'allow', scope: 'always' },
    { toolPattern: 'shell_*', action: 'deny', scope: 'session' },
    { toolPattern: 'read_*', action: 'ask', scope: 'once' },
  ];

  const defaultProps: PermissionSettingsProps = {
    rules: mockRules,
    onRulesChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the component with title', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(screen.getByTestId('permission-settings')).toBeInTheDocument();
      expect(screen.getByText('Permission Rules')).toBeInTheDocument();
    });

    it('should render the add button when rules exist', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-add-button')
      ).toBeInTheDocument();
    });

    it('should render all rules in the list', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(screen.getByTestId('permission-settings-list')).toBeInTheDocument();
      expect(screen.getByTestId('permission-settings-rule-0')).toBeInTheDocument();
      expect(screen.getByTestId('permission-settings-rule-1')).toBeInTheDocument();
      expect(screen.getByTestId('permission-settings-rule-2')).toBeInTheDocument();
    });

    it('should display rule patterns correctly', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-rule-0-pattern')
      ).toHaveTextContent('file_*');
      expect(
        screen.getByTestId('permission-settings-rule-1-pattern')
      ).toHaveTextContent('shell_*');
      expect(
        screen.getByTestId('permission-settings-rule-2-pattern')
      ).toHaveTextContent('read_*');
    });

    it('should display rule actions correctly', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-rule-0-action')
      ).toHaveTextContent('Allow');
      expect(
        screen.getByTestId('permission-settings-rule-1-action')
      ).toHaveTextContent('Deny');
      expect(
        screen.getByTestId('permission-settings-rule-2-action')
      ).toHaveTextContent('Ask');
    });

    it('should display rule scopes correctly', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-rule-0-scope')
      ).toHaveTextContent('Always');
      expect(
        screen.getByTestId('permission-settings-rule-1-scope')
      ).toHaveTextContent('Session');
      expect(
        screen.getByTestId('permission-settings-rule-2-scope')
      ).toHaveTextContent('Once');
    });

    it('should display edit and delete buttons for each rule', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-rule-0-edit')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-rule-0-delete')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-rule-1-edit')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-rule-1-delete')
      ).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should render empty state when no rules exist', () => {
      render(<PermissionSettings {...defaultProps} rules={[]} />);

      expect(screen.getByTestId('permission-settings-empty')).toBeInTheDocument();
      expect(
        screen.getByText('No permission rules configured')
      ).toBeInTheDocument();
    });

    it('should render add button in empty state', () => {
      render(<PermissionSettings {...defaultProps} rules={[]} />);

      expect(
        screen.getByTestId('permission-settings-empty-add-button')
      ).toBeInTheDocument();
    });

    it('should not render the header add button in empty state', () => {
      render(<PermissionSettings {...defaultProps} rules={[]} />);

      expect(
        screen.queryByTestId('permission-settings-add-button')
      ).not.toBeInTheDocument();
    });

    it('should show form when clicking add button in empty state', () => {
      render(<PermissionSettings {...defaultProps} rules={[]} />);

      fireEvent.click(screen.getByTestId('permission-settings-empty-add-button'));

      expect(screen.getByTestId('permission-settings-form')).toBeInTheDocument();
    });
  });

  describe('Add Rule', () => {
    it('should show form when clicking add button', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(screen.getByTestId('permission-settings-form')).toBeInTheDocument();
    });

    it('should hide add button when form is shown', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(
        screen.queryByTestId('permission-settings-add-button')
      ).not.toBeInTheDocument();
    });

    it('should render form with pattern input, action select, and scope select', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(
        screen.getByTestId('permission-settings-pattern-input')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-action-select')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-scope-select')
      ).toBeInTheDocument();
    });

    it('should render save and cancel buttons in form', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(
        screen.getByTestId('permission-settings-save-button')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-cancel-button')
      ).toBeInTheDocument();
    });

    it('should have save button disabled when pattern is empty', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(screen.getByTestId('permission-settings-save-button')).toBeDisabled();
    });

    it('should enable save button when pattern is entered', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'new_tool_*' },
      });

      expect(
        screen.getByTestId('permission-settings-save-button')
      ).not.toBeDisabled();
    });

    it('should call onRulesChange with new rule when saving', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'new_tool_*' },
      });
      fireEvent.change(screen.getByTestId('permission-settings-action-select'), {
        target: { value: 'allow' },
      });
      fireEvent.change(screen.getByTestId('permission-settings-scope-select'), {
        target: { value: 'always' },
      });
      fireEvent.click(screen.getByTestId('permission-settings-save-button'));

      expect(onRulesChange).toHaveBeenCalledTimes(1);
      expect(onRulesChange).toHaveBeenCalledWith([
        ...mockRules,
        { toolPattern: 'new_tool_*', action: 'allow', scope: 'always' },
      ]);
    });

    it('should hide form after saving', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'new_tool_*' },
      });
      fireEvent.click(screen.getByTestId('permission-settings-save-button'));

      expect(
        screen.queryByTestId('permission-settings-form')
      ).not.toBeInTheDocument();
    });

    it('should hide form when clicking cancel', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.click(screen.getByTestId('permission-settings-cancel-button'));

      expect(
        screen.queryByTestId('permission-settings-form')
      ).not.toBeInTheDocument();
    });

    it('should not call onRulesChange when clicking cancel', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'new_tool_*' },
      });
      fireEvent.click(screen.getByTestId('permission-settings-cancel-button'));

      expect(onRulesChange).not.toHaveBeenCalled();
    });

    it('should trim whitespace from pattern when saving', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: '  new_tool_*  ' },
      });
      fireEvent.click(screen.getByTestId('permission-settings-save-button'));

      expect(onRulesChange).toHaveBeenCalledWith([
        ...mockRules,
        { toolPattern: 'new_tool_*', action: 'ask', scope: 'once' },
      ]);
    });
  });

  describe('Edit Rule', () => {
    it('should show form with rule values when clicking edit', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-edit'));

      expect(screen.getByTestId('permission-settings-form')).toBeInTheDocument();
      expect(screen.getByTestId('permission-settings-pattern-input')).toHaveValue(
        'file_*'
      );
      expect(screen.getByTestId('permission-settings-action-select')).toHaveValue(
        'allow'
      );
      expect(screen.getByTestId('permission-settings-scope-select')).toHaveValue(
        'always'
      );
    });

    it('should hide the rule item being edited', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-edit'));

      // The rule item should be replaced by the form
      expect(
        screen.queryByTestId('permission-settings-rule-0-pattern')
      ).not.toBeInTheDocument();
    });

    it('should call onRulesChange with updated rule when saving', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-rule-1-edit'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'updated_*' },
      });
      fireEvent.change(screen.getByTestId('permission-settings-action-select'), {
        target: { value: 'allow' },
      });
      fireEvent.click(screen.getByTestId('permission-settings-save-button'));

      expect(onRulesChange).toHaveBeenCalledTimes(1);
      expect(onRulesChange).toHaveBeenCalledWith([
        mockRules[0],
        { toolPattern: 'updated_*', action: 'allow', scope: 'session' },
        mockRules[2],
      ]);
    });

    it('should restore original rule when clicking cancel', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-edit'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'changed_*' },
      });
      fireEvent.click(screen.getByTestId('permission-settings-cancel-button'));

      // Original rule should be visible again
      expect(
        screen.getByTestId('permission-settings-rule-0-pattern')
      ).toHaveTextContent('file_*');
    });
  });

  describe('Delete Rule', () => {
    it('should show delete confirmation when clicking delete', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));

      expect(
        screen.getByText('Are you sure you want to delete this?')
      ).toBeInTheDocument();
    });

    it('should show confirm and cancel buttons in delete confirmation', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));

      expect(
        screen.getByTestId('permission-settings-rule-0-confirm-delete')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-rule-0-cancel-delete')
      ).toBeInTheDocument();
    });

    it('should call onRulesChange without deleted rule when confirming', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-rule-1-delete'));
      fireEvent.click(
        screen.getByTestId('permission-settings-rule-1-confirm-delete')
      );

      expect(onRulesChange).toHaveBeenCalledTimes(1);
      expect(onRulesChange).toHaveBeenCalledWith([mockRules[0], mockRules[2]]);
    });

    it('should hide delete confirmation when clicking cancel', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));
      fireEvent.click(
        screen.getByTestId('permission-settings-rule-0-cancel-delete')
      );

      expect(
        screen.queryByText('Are you sure you want to delete this?')
      ).not.toBeInTheDocument();
    });

    it('should not call onRulesChange when canceling delete', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));
      fireEvent.click(
        screen.getByTestId('permission-settings-rule-0-cancel-delete')
      );

      expect(onRulesChange).not.toHaveBeenCalled();
    });

    it('should only show delete confirmation for one rule at a time', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));
      fireEvent.click(screen.getByTestId('permission-settings-rule-1-delete'));

      // Only rule 1 should show confirmation
      expect(
        screen.queryByTestId('permission-settings-rule-0-confirm-delete')
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId('permission-settings-rule-1-confirm-delete')
      ).toBeInTheDocument();
    });
  });

  describe('Form State Management', () => {
    it('should reset form when switching from add to edit', () => {
      render(<PermissionSettings {...defaultProps} />);

      // Start adding
      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: 'new_pattern' },
      });

      // Switch to edit
      fireEvent.click(screen.getByTestId('permission-settings-rule-0-edit'));

      // Form should show rule 0's values
      expect(screen.getByTestId('permission-settings-pattern-input')).toHaveValue(
        'file_*'
      );
    });

    it('should close delete confirmation when starting to add', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));
      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(
        screen.queryByTestId('permission-settings-rule-0-confirm-delete')
      ).not.toBeInTheDocument();
    });

    it('should close delete confirmation when starting to edit', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));
      fireEvent.click(screen.getByTestId('permission-settings-rule-1-edit'));

      expect(
        screen.queryByTestId('permission-settings-rule-0-confirm-delete')
      ).not.toBeInTheDocument();
    });

    it('should use default form values when adding new rule', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(screen.getByTestId('permission-settings-pattern-input')).toHaveValue(
        ''
      );
      expect(screen.getByTestId('permission-settings-action-select')).toHaveValue(
        'ask'
      );
      expect(screen.getByTestId('permission-settings-scope-select')).toHaveValue(
        'once'
      );
    });
  });

  describe('Accessibility', () => {
    it('should have proper labels for form inputs', () => {
      render(<PermissionSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));

      expect(screen.getByLabelText('Tool Pattern')).toBeInTheDocument();
      expect(screen.getByLabelText('Action')).toBeInTheDocument();
      expect(screen.getByLabelText('Scope')).toBeInTheDocument();
    });

    it('should have aria-label on edit buttons', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-rule-0-edit')
      ).toHaveAttribute('aria-label', 'Edit Rule');
    });

    it('should have aria-label on delete buttons', () => {
      render(<PermissionSettings {...defaultProps} />);

      expect(
        screen.getByTestId('permission-settings-rule-0-delete')
      ).toHaveAttribute('aria-label', 'Delete Rule');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty rules array', () => {
      render(<PermissionSettings {...defaultProps} rules={[]} />);

      expect(screen.getByTestId('permission-settings-empty')).toBeInTheDocument();
    });

    it('should handle single rule', () => {
      render(<PermissionSettings {...defaultProps} rules={[mockRules[0]]} />);

      expect(screen.getByTestId('permission-settings-rule-0')).toBeInTheDocument();
      expect(
        screen.queryByTestId('permission-settings-rule-1')
      ).not.toBeInTheDocument();
    });

    it('should not save rule with only whitespace pattern', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings {...defaultProps} onRulesChange={onRulesChange} />
      );

      fireEvent.click(screen.getByTestId('permission-settings-add-button'));
      fireEvent.change(screen.getByTestId('permission-settings-pattern-input'), {
        target: { value: '   ' },
      });

      // Save button should still be disabled
      expect(screen.getByTestId('permission-settings-save-button')).toBeDisabled();
    });

    it('should handle deleting the last rule', () => {
      const onRulesChange = vi.fn();
      render(
        <PermissionSettings
          {...defaultProps}
          rules={[mockRules[0]]}
          onRulesChange={onRulesChange}
        />
      );

      fireEvent.click(screen.getByTestId('permission-settings-rule-0-delete'));
      fireEvent.click(
        screen.getByTestId('permission-settings-rule-0-confirm-delete')
      );

      expect(onRulesChange).toHaveBeenCalledWith([]);
    });
  });
});
