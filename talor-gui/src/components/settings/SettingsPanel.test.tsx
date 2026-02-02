/**
 * SettingsPanel Component Tests
 * 设置面板组件测试
 *
 * Tests for the SettingsPanel component including:
 * - Rendering and visibility
 * - Tab navigation
 * - Close functionality
 * - Keyboard interactions
 * - Accessibility
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import type { SettingsPanelProps } from './SettingsPanel';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.title': 'Settings',
        'settings.general': 'General',
        'settings.providers': 'Providers',
        'settings.mcpServers': 'MCP Servers',
        'settings.permissions': 'Permissions',
        'settings.theme.description': 'Choose your preferred color theme',
        'settings.provider.noProviders': 'No providers configured',
        'settings.mcp.noServers': 'No MCP servers configured',
        'permission.rules.noRules': 'No permission rules configured',
        'a11y.closeDialog': 'Close dialog',
      };
      return translations[key] || key;
    },
  }),
}));

/**
 * Helper function to render SettingsPanel
 * 渲染 SettingsPanel 的辅助函数
 */
const renderSettingsPanel = (props: Partial<SettingsPanelProps> = {}) => {
  const defaultProps: SettingsPanelProps = {
    isOpen: true,
    onClose: vi.fn(),
    ...props,
  };

  return {
    ...render(<SettingsPanel {...defaultProps} />),
    props: defaultProps,
  };
};

describe('SettingsPanel', () => {
  afterEach(() => {
    // Clean up body overflow style
    document.body.style.overflow = '';
  });

  describe('Rendering', () => {
    it('should render when isOpen is true', () => {
      renderSettingsPanel({ isOpen: true });

      expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
      expect(screen.getByTestId('settings-panel-overlay')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      renderSettingsPanel({ isOpen: false });

      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('settings-panel-overlay')).not.toBeInTheDocument();
    });

    it('should render the settings title', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-title')).toHaveTextContent('Settings');
    });

    it('should render the close button', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-close')).toBeInTheDocument();
    });

    it('should render all tab buttons', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-tab-general')).toBeInTheDocument();
      expect(screen.getByTestId('settings-panel-tab-providers')).toBeInTheDocument();
      expect(screen.getByTestId('settings-panel-tab-mcpServers')).toBeInTheDocument();
      expect(screen.getByTestId('settings-panel-tab-permissions')).toBeInTheDocument();
    });

    it('should have proper ARIA attributes for dialog', () => {
      renderSettingsPanel();

      const overlay = screen.getByTestId('settings-panel-overlay');
      expect(overlay).toHaveAttribute('role', 'dialog');
      expect(overlay).toHaveAttribute('aria-modal', 'true');
      expect(overlay).toHaveAttribute('aria-labelledby', 'settings-panel-title');
    });
  });

  describe('Tab Navigation', () => {
    it('should show general tab as active by default', () => {
      renderSettingsPanel();

      const generalTab = screen.getByTestId('settings-panel-tab-general');
      expect(generalTab).toHaveAttribute('aria-selected', 'true');
    });

    it('should render general content by default', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-general-content')).toBeInTheDocument();
    });

    it('should switch to providers tab when clicked', () => {
      renderSettingsPanel();

      const providersTab = screen.getByTestId('settings-panel-tab-providers');
      fireEvent.click(providersTab);

      expect(providersTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('settings-panel-providers-content')).toBeInTheDocument();
    });

    it('should switch to MCP servers tab when clicked', () => {
      renderSettingsPanel();

      const mcpTab = screen.getByTestId('settings-panel-tab-mcpServers');
      fireEvent.click(mcpTab);

      expect(mcpTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('settings-panel-mcp-content')).toBeInTheDocument();
    });

    it('should switch to permissions tab when clicked', () => {
      renderSettingsPanel();

      const permissionsTab = screen.getByTestId('settings-panel-tab-permissions');
      fireEvent.click(permissionsTab);

      expect(permissionsTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('settings-panel-permissions-content')).toBeInTheDocument();
    });

    it('should have proper ARIA attributes for tabs', () => {
      renderSettingsPanel();

      const tabs = screen.getByTestId('settings-panel-tabs');
      expect(tabs).toHaveAttribute('role', 'tablist');

      const generalTab = screen.getByTestId('settings-panel-tab-general');
      expect(generalTab).toHaveAttribute('role', 'tab');
      expect(generalTab).toHaveAttribute('aria-controls', 'settings-panel-general');
    });

    it('should have proper ARIA attributes for tab panel', () => {
      renderSettingsPanel();

      const content = screen.getByTestId('settings-panel-content');
      expect(content).toHaveAttribute('role', 'tabpanel');
    });

    it('should deselect previous tab when switching tabs', () => {
      renderSettingsPanel();

      const generalTab = screen.getByTestId('settings-panel-tab-general');
      const providersTab = screen.getByTestId('settings-panel-tab-providers');

      // Initially general is selected
      expect(generalTab).toHaveAttribute('aria-selected', 'true');
      expect(providersTab).toHaveAttribute('aria-selected', 'false');

      // Click providers tab
      fireEvent.click(providersTab);

      // Now providers is selected, general is not
      expect(generalTab).toHaveAttribute('aria-selected', 'false');
      expect(providersTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Close Functionality', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      renderSettingsPanel({ onClose });

      const closeButton = screen.getByTestId('settings-panel-close');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      renderSettingsPanel({ onClose });

      const overlay = screen.getByTestId('settings-panel-overlay');
      fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when panel content is clicked', () => {
      const onClose = vi.fn();
      renderSettingsPanel({ onClose });

      const panel = screen.getByTestId('settings-panel');
      fireEvent.click(panel);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      renderSettingsPanel({ onClose });

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onClose for other keys', () => {
      const onClose = vi.fn();
      renderSettingsPanel({ onClose });

      fireEvent.keyDown(document, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'Tab' });
      fireEvent.keyDown(document, { key: 'Space' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Body Scroll Lock', () => {
    it('should prevent body scroll when panel is open', () => {
      renderSettingsPanel({ isOpen: true });

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should restore body scroll when panel is closed', () => {
      const { rerender, props } = renderSettingsPanel({ isOpen: true });

      expect(document.body.style.overflow).toBe('hidden');

      rerender(<SettingsPanel {...props} isOpen={false} />);

      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('Tab Content', () => {
    it('should show general settings content when general tab is active', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-general-content')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-panel-providers-content')).not.toBeInTheDocument();
    });

    it('should show providers content when providers tab is active', () => {
      renderSettingsPanel();

      fireEvent.click(screen.getByTestId('settings-panel-tab-providers'));

      expect(screen.getByTestId('settings-panel-providers-content')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-panel-general-content')).not.toBeInTheDocument();
    });

    it('should show MCP servers content when MCP tab is active', () => {
      renderSettingsPanel();

      fireEvent.click(screen.getByTestId('settings-panel-tab-mcpServers'));

      expect(screen.getByTestId('settings-panel-mcp-content')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-panel-general-content')).not.toBeInTheDocument();
    });

    it('should show permissions content when permissions tab is active', () => {
      renderSettingsPanel();

      fireEvent.click(screen.getByTestId('settings-panel-tab-permissions'));

      expect(screen.getByTestId('settings-panel-permissions-content')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-panel-general-content')).not.toBeInTheDocument();
    });
  });

  describe('Tab Labels', () => {
    it('should display correct labels for all tabs', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-tab-general')).toHaveTextContent('General');
      expect(screen.getByTestId('settings-panel-tab-providers')).toHaveTextContent('Providers');
      expect(screen.getByTestId('settings-panel-tab-mcpServers')).toHaveTextContent('MCP Servers');
      expect(screen.getByTestId('settings-panel-tab-permissions')).toHaveTextContent('Permissions');
    });
  });

  describe('Accessibility', () => {
    it('should have role="dialog" on the overlay', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-overlay')).toHaveAttribute(
        'role',
        'dialog'
      );
    });

    it('should have aria-modal="true" on the overlay', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-overlay')).toHaveAttribute(
        'aria-modal',
        'true'
      );
    });

    it('should have aria-labelledby pointing to the title', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-overlay')).toHaveAttribute(
        'aria-labelledby',
        'settings-panel-title'
      );
    });

    it('should have role="tablist" on the tab navigation', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-tabs')).toHaveAttribute(
        'role',
        'tablist'
      );
    });

    it('should have role="tab" on each tab button', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-tab-general')).toHaveAttribute('role', 'tab');
      expect(screen.getByTestId('settings-panel-tab-providers')).toHaveAttribute('role', 'tab');
      expect(screen.getByTestId('settings-panel-tab-mcpServers')).toHaveAttribute('role', 'tab');
      expect(screen.getByTestId('settings-panel-tab-permissions')).toHaveAttribute('role', 'tab');
    });

    it('should have role="tabpanel" on the content area', () => {
      renderSettingsPanel();

      expect(screen.getByTestId('settings-panel-content')).toHaveAttribute(
        'role',
        'tabpanel'
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle rapid tab switching', () => {
      renderSettingsPanel();

      // Rapidly switch between tabs
      fireEvent.click(screen.getByTestId('settings-panel-tab-providers'));
      fireEvent.click(screen.getByTestId('settings-panel-tab-mcpServers'));
      fireEvent.click(screen.getByTestId('settings-panel-tab-permissions'));
      fireEvent.click(screen.getByTestId('settings-panel-tab-general'));

      // Should end up on general tab
      expect(screen.getByTestId('settings-panel-tab-general')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('settings-panel-general-content')).toBeInTheDocument();
    });

    it('should maintain tab state when clicking same tab multiple times', () => {
      renderSettingsPanel();

      const providersTab = screen.getByTestId('settings-panel-tab-providers');

      // Click providers tab multiple times
      fireEvent.click(providersTab);
      fireEvent.click(providersTab);
      fireEvent.click(providersTab);

      // Should still be on providers tab
      expect(providersTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('settings-panel-providers-content')).toBeInTheDocument();
    });
  });
});
