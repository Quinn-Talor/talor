/**
 * ProviderSettings Component Tests
 * 提供商设置组件测试
 *
 * Tests for the ProviderSettings component that manages LLM provider
 * configurations including API keys and base URLs.
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderSettings } from './ProviderSettings';
import type { ProviderSettingsProps } from './ProviderSettings';
import type { ProviderConfig } from '../../types/config';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.provider.title': 'LLM Providers',
        'settings.provider.add': 'Add Provider',
        'settings.provider.edit': 'Edit Provider',
        'settings.provider.delete': 'Delete Provider',
        'settings.provider.name': 'Provider Name',
        'settings.provider.apiKey': 'API Key',
        'settings.provider.apiKeyPlaceholder': 'Enter your API key',
        'settings.provider.baseUrl': 'Base URL',
        'settings.provider.baseUrlPlaceholder': 'Enter custom base URL (optional)',
        'settings.provider.noProviders': 'No providers configured',
        'settings.provider.addFirst': 'Add a provider to get started',
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
        'common.show': 'Show',
        'common.hide': 'Hide',
        'session.deleteConfirm': 'Are you sure you want to delete this?',
      };
      return translations[key] || key;
    },
  }),
}));

describe('ProviderSettings', () => {
  const mockProviders: ProviderConfig[] = [
    {
      id: 'provider-1',
      name: 'OpenAI',
      apiKey: 'sk-test-key-12345678',
      baseUrl: 'https://api.openai.com/v1',
    },
    {
      id: 'provider-2',
      name: 'Anthropic',
      apiKey: 'sk-ant-test-key',
    },
  ];

  const defaultProps: ProviderSettingsProps = {
    providers: mockProviders,
    onProvidersChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the component with title', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByTestId('provider-settings')).toBeInTheDocument();
      expect(screen.getByText('LLM Providers')).toBeInTheDocument();
    });

    it('should render empty state when no providers', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      expect(screen.getByTestId('provider-settings-empty')).toBeInTheDocument();
      expect(screen.getByText('No providers configured')).toBeInTheDocument();
      expect(screen.getByText('Add a provider to get started')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-empty-add-button')).toBeInTheDocument();
    });

    it('should render provider list when providers exist', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByTestId('provider-settings-list')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-1')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-2')).toBeInTheDocument();
    });

    it('should display provider names', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByText('OpenAI')).toBeInTheDocument();
      expect(screen.getByText('Anthropic')).toBeInTheDocument();
    });

    it('should display masked API keys', () => {
      render(<ProviderSettings {...defaultProps} />);

      // API keys should be masked - should not show full API key
      expect(screen.queryByText('sk-test-key-12345678')).not.toBeInTheDocument();
      expect(screen.queryByText('sk-ant-test-key')).not.toBeInTheDocument();
    });

    it('should display base URL when configured', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByText(/https:\/\/api\.openai\.com\/v1/)).toBeInTheDocument();
    });

    it('should show add button when providers exist', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByTestId('provider-settings-add-button')).toBeInTheDocument();
    });

    it('should display edit and delete buttons for each provider', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByTestId('provider-settings-item-provider-1-edit')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-1-delete')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-2-edit')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-2-delete')).toBeInTheDocument();
    });
  });


  describe('Empty State', () => {
    it('should render empty state when no providers exist', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      expect(screen.getByTestId('provider-settings-empty')).toBeInTheDocument();
      expect(screen.getByText('No providers configured')).toBeInTheDocument();
    });

    it('should render add button in empty state', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      expect(screen.getByTestId('provider-settings-empty-add-button')).toBeInTheDocument();
    });

    it('should not render the header add button in empty state', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      expect(screen.queryByTestId('provider-settings-add-button')).not.toBeInTheDocument();
    });

    it('should show form when clicking add button in empty state', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));

      expect(screen.getByTestId('provider-settings-form')).toBeInTheDocument();
    });
  });

  describe('Add Provider', () => {
    it('should show form when clicking add button', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.getByTestId('provider-settings-form')).toBeInTheDocument();
    });

    it('should hide add button when form is shown', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.queryByTestId('provider-settings-add-button')).not.toBeInTheDocument();
    });

    it('should render form with name, apiKey, and baseUrl inputs', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.getByTestId('provider-settings-name-input')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-apikey-input')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-baseurl-input')).toBeInTheDocument();
    });

    it('should render save and cancel buttons in form', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.getByTestId('provider-settings-save-button')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-cancel-button')).toBeInTheDocument();
    });

    it('should have save button disabled when name is empty', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.getByTestId('provider-settings-save-button')).toBeDisabled();
    });

    it('should enable save button when name is entered', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'New Provider' },
      });

      expect(screen.getByTestId('provider-settings-save-button')).not.toBeDisabled();
    });


    it('should call onProvidersChange with new provider when saving', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} providers={[]} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'New Provider' },
      });
      fireEvent.change(screen.getByTestId('provider-settings-apikey-input'), {
        target: { value: 'new-api-key' },
      });
      fireEvent.change(screen.getByTestId('provider-settings-baseurl-input'), {
        target: { value: 'https://api.example.com' },
      });
      fireEvent.click(screen.getByTestId('provider-settings-save-button'));

      expect(onProvidersChange).toHaveBeenCalledTimes(1);
      const newProviders = onProvidersChange.mock.calls[0][0];
      expect(newProviders).toHaveLength(1);
      expect(newProviders[0].name).toBe('New Provider');
      expect(newProviders[0].apiKey).toBe('new-api-key');
      expect(newProviders[0].baseUrl).toBe('https://api.example.com');
    });

    it('should hide form after saving', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'New Provider' },
      });
      fireEvent.click(screen.getByTestId('provider-settings-save-button'));

      expect(screen.queryByTestId('provider-settings-form')).not.toBeInTheDocument();
    });

    it('should hide form when clicking cancel', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));
      fireEvent.click(screen.getByTestId('provider-settings-cancel-button'));

      expect(screen.queryByTestId('provider-settings-form')).not.toBeInTheDocument();
    });

    it('should not call onProvidersChange when clicking cancel', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'New Provider' },
      });
      fireEvent.click(screen.getByTestId('provider-settings-cancel-button'));

      expect(onProvidersChange).not.toHaveBeenCalled();
    });

    it('should trim whitespace from inputs when saving', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} providers={[]} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: '  Trimmed Provider  ' },
      });
      fireEvent.change(screen.getByTestId('provider-settings-apikey-input'), {
        target: { value: '  trimmed-key  ' },
      });
      fireEvent.click(screen.getByTestId('provider-settings-save-button'));

      const newProviders = onProvidersChange.mock.calls[0][0];
      expect(newProviders[0].name).toBe('Trimmed Provider');
      expect(newProviders[0].apiKey).toBe('trimmed-key');
    });

    it('should handle empty optional fields', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} providers={[]} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'Minimal Provider' },
      });
      // Don't fill in optional fields
      fireEvent.click(screen.getByTestId('provider-settings-save-button'));

      const newProviders = onProvidersChange.mock.calls[0][0];
      expect(newProviders[0].name).toBe('Minimal Provider');
      expect(newProviders[0].apiKey).toBeUndefined();
      expect(newProviders[0].baseUrl).toBeUndefined();
    });
  });


  describe('Edit Provider', () => {
    it('should show form with provider values when clicking edit', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-edit'));

      expect(screen.getByTestId('provider-settings-form')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-name-input')).toHaveValue('OpenAI');
      expect(screen.getByTestId('provider-settings-apikey-input')).toHaveValue('sk-test-key-12345678');
      expect(screen.getByTestId('provider-settings-baseurl-input')).toHaveValue('https://api.openai.com/v1');
    });

    it('should hide the provider item being edited', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-edit'));

      // The provider item should be replaced by the form
      expect(screen.queryByTestId('provider-settings-item-provider-1-name')).not.toBeInTheDocument();
    });

    it('should call onProvidersChange with updated provider when saving', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-edit'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'Updated OpenAI' },
      });
      fireEvent.click(screen.getByTestId('provider-settings-save-button'));

      expect(onProvidersChange).toHaveBeenCalledTimes(1);
      const updatedProviders = onProvidersChange.mock.calls[0][0];
      expect(updatedProviders).toHaveLength(2);
      expect(updatedProviders[0].name).toBe('Updated OpenAI');
      expect(updatedProviders[1].name).toBe('Anthropic');
    });

    it('should restore original provider when clicking cancel', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-edit'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'Changed Name' },
      });
      fireEvent.click(screen.getByTestId('provider-settings-cancel-button'));

      // Original provider should be visible again
      expect(screen.getByTestId('provider-settings-item-provider-1-name')).toHaveTextContent('OpenAI');
    });
  });


  describe('Delete Provider', () => {
    it('should show delete confirmation when clicking delete', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));

      expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
    });

    it('should show confirm and cancel buttons in delete confirmation', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));

      expect(screen.getByTestId('provider-settings-item-provider-1-confirm-delete')).toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-1-cancel-delete')).toBeInTheDocument();
    });

    it('should call onProvidersChange without deleted provider when confirming', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-confirm-delete'));

      expect(onProvidersChange).toHaveBeenCalledTimes(1);
      const updatedProviders = onProvidersChange.mock.calls[0][0];
      expect(updatedProviders).toHaveLength(1);
      expect(updatedProviders[0].id).toBe('provider-2');
    });

    it('should hide delete confirmation when clicking cancel', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-cancel-delete'));

      expect(screen.queryByText('Are you sure you want to delete this?')).not.toBeInTheDocument();
    });

    it('should not call onProvidersChange when canceling delete', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-cancel-delete'));

      expect(onProvidersChange).not.toHaveBeenCalled();
    });

    it('should only show delete confirmation for one provider at a time', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-2-delete'));

      // Only provider 2 should show confirmation
      expect(screen.queryByTestId('provider-settings-item-provider-1-confirm-delete')).not.toBeInTheDocument();
      expect(screen.getByTestId('provider-settings-item-provider-2-confirm-delete')).toBeInTheDocument();
    });

    it('should handle deleting the last provider', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} providers={[mockProviders[0]]} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-confirm-delete'));

      expect(onProvidersChange).toHaveBeenCalledWith([]);
    });
  });


  describe('API Key Visibility Toggle', () => {
    it('should have password type by default for API key input', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));

      expect(screen.getByTestId('provider-settings-apikey-input')).toHaveAttribute('type', 'password');
    });

    it('should toggle API key visibility when clicking eye icon', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));

      const apiKeyInput = screen.getByTestId('provider-settings-apikey-input');
      expect(apiKeyInput).toHaveAttribute('type', 'password');

      fireEvent.click(screen.getByTestId('provider-settings-apikey-toggle'));
      expect(apiKeyInput).toHaveAttribute('type', 'text');

      fireEvent.click(screen.getByTestId('provider-settings-apikey-toggle'));
      expect(apiKeyInput).toHaveAttribute('type', 'password');
    });

    it('should reset API key visibility when form is closed', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));
      fireEvent.click(screen.getByTestId('provider-settings-apikey-toggle'));
      expect(screen.getByTestId('provider-settings-apikey-input')).toHaveAttribute('type', 'text');

      fireEvent.click(screen.getByTestId('provider-settings-cancel-button'));
      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));

      expect(screen.getByTestId('provider-settings-apikey-input')).toHaveAttribute('type', 'password');
    });
  });

  describe('Form State Management', () => {
    it('should reset form when switching from add to edit', () => {
      render(<ProviderSettings {...defaultProps} />);

      // Start adding
      fireEvent.click(screen.getByTestId('provider-settings-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: 'New Provider' },
      });

      // Switch to edit
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-edit'));

      // Form should show provider 1's values
      expect(screen.getByTestId('provider-settings-name-input')).toHaveValue('OpenAI');
    });

    it('should close delete confirmation when starting to add', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.queryByTestId('provider-settings-item-provider-1-confirm-delete')).not.toBeInTheDocument();
    });

    it('should close delete confirmation when starting to edit', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-item-provider-1-delete'));
      fireEvent.click(screen.getByTestId('provider-settings-item-provider-2-edit'));

      expect(screen.queryByTestId('provider-settings-item-provider-1-confirm-delete')).not.toBeInTheDocument();
    });

    it('should use empty form values when adding new provider', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.getByTestId('provider-settings-name-input')).toHaveValue('');
      expect(screen.getByTestId('provider-settings-apikey-input')).toHaveValue('');
      expect(screen.getByTestId('provider-settings-baseurl-input')).toHaveValue('');
    });
  });


  describe('Accessibility', () => {
    it('should have proper labels for form inputs', () => {
      render(<ProviderSettings {...defaultProps} />);

      fireEvent.click(screen.getByTestId('provider-settings-add-button'));

      expect(screen.getByLabelText(/Provider Name/)).toBeInTheDocument();
      expect(screen.getByLabelText(/API Key/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Base URL/)).toBeInTheDocument();
    });

    it('should have aria-label on edit buttons', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByTestId('provider-settings-item-provider-1-edit')).toHaveAttribute('aria-label', 'Edit Provider');
    });

    it('should have aria-label on delete buttons', () => {
      render(<ProviderSettings {...defaultProps} />);

      expect(screen.getByTestId('provider-settings-item-provider-1-delete')).toHaveAttribute('aria-label', 'Delete Provider');
    });

    it('should have aria-label on API key toggle button', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));

      expect(screen.getByTestId('provider-settings-apikey-toggle')).toHaveAttribute('aria-label');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty providers array', () => {
      render(<ProviderSettings {...defaultProps} providers={[]} />);

      expect(screen.getByTestId('provider-settings-empty')).toBeInTheDocument();
    });

    it('should handle single provider', () => {
      render(<ProviderSettings {...defaultProps} providers={[mockProviders[0]]} />);

      expect(screen.getByTestId('provider-settings-item-provider-1')).toBeInTheDocument();
      expect(screen.queryByTestId('provider-settings-item-provider-2')).not.toBeInTheDocument();
    });

    it('should not save provider with only whitespace name', () => {
      const onProvidersChange = vi.fn();
      render(<ProviderSettings {...defaultProps} providers={[]} onProvidersChange={onProvidersChange} />);

      fireEvent.click(screen.getByTestId('provider-settings-empty-add-button'));
      fireEvent.change(screen.getByTestId('provider-settings-name-input'), {
        target: { value: '   ' },
      });

      // Save button should still be disabled
      expect(screen.getByTestId('provider-settings-save-button')).toBeDisabled();
    });

    it('should handle provider without optional fields', () => {
      const providerWithoutOptionals: ProviderConfig = {
        id: 'minimal-provider',
        name: 'Minimal',
      };
      render(<ProviderSettings {...defaultProps} providers={[providerWithoutOptionals]} />);

      expect(screen.getByTestId('provider-settings-item-minimal-provider')).toBeInTheDocument();
      expect(screen.getByText('Minimal')).toBeInTheDocument();
    });
  });
});