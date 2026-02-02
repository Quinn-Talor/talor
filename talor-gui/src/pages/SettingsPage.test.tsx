/**
 * SettingsPage Component Tests
 * 设置页面组件测试
 *
 * Tests for the SettingsPage component that integrates all settings components.
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { SettingsPage } from './SettingsPage';
import { useSettingsStore } from '../store/settings';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

/**
 * Test wrapper component
 * 测试包装组件
 */
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <I18nextProvider i18n={i18n}>
      {children}
    </I18nextProvider>
  </BrowserRouter>
);

/**
 * Render helper function
 * 渲染辅助函数
 */
const renderSettingsPage = () => {
  return render(
    <TestWrapper>
      <SettingsPage />
    </TestWrapper>
  );
};

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset settings store to initial state
    useSettingsStore.setState({
      theme: 'system',
      language: 'en',
      defaultModel: null,
      providers: [],
      mcpServers: [],
    });
  });

  describe('Rendering', () => {
    it('should render the settings page', () => {
      renderSettingsPage();

      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-title')).toBeInTheDocument();
    });

    it('should render the back button', () => {
      renderSettingsPage();

      expect(screen.getByTestId('settings-page-back-button')).toBeInTheDocument();
    });

    it('should render all tab buttons', () => {
      renderSettingsPage();

      expect(screen.getByTestId('settings-page-tab-general')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-tab-providers')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-tab-models')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-tab-mcpServers')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-tab-permissions')).toBeInTheDocument();
    });

    it('should render general settings by default', () => {
      renderSettingsPage();

      expect(screen.getByTestId('settings-page-general-content')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should navigate back when back button is clicked', () => {
      renderSettingsPage();

      const backButton = screen.getByTestId('settings-page-back-button');
      fireEvent.click(backButton);

      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('Tab Navigation', () => {
    it('should switch to providers tab when clicked', () => {
      renderSettingsPage();

      const providersTab = screen.getByTestId('settings-page-tab-providers');
      fireEvent.click(providersTab);

      expect(screen.getByTestId('settings-page-providers-content')).toBeInTheDocument();
    });

    it('should switch to models tab when clicked', () => {
      renderSettingsPage();

      const modelsTab = screen.getByTestId('settings-page-tab-models');
      fireEvent.click(modelsTab);

      expect(screen.getByTestId('settings-page-models-content')).toBeInTheDocument();
    });

    it('should switch to MCP servers tab when clicked', () => {
      renderSettingsPage();

      const mcpTab = screen.getByTestId('settings-page-tab-mcpServers');
      fireEvent.click(mcpTab);

      expect(screen.getByTestId('settings-page-mcp-content')).toBeInTheDocument();
    });

    it('should switch to permissions tab when clicked', () => {
      renderSettingsPage();

      const permissionsTab = screen.getByTestId('settings-page-tab-permissions');
      fireEvent.click(permissionsTab);

      expect(screen.getByTestId('settings-page-permissions-content')).toBeInTheDocument();
    });

    it('should highlight the active tab', () => {
      renderSettingsPage();

      const generalTab = screen.getByTestId('settings-page-tab-general');
      expect(generalTab).toHaveAttribute('aria-selected', 'true');

      const providersTab = screen.getByTestId('settings-page-tab-providers');
      fireEvent.click(providersTab);

      expect(providersTab).toHaveAttribute('aria-selected', 'true');
      expect(generalTab).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('General Settings', () => {
    it('should render theme options', () => {
      renderSettingsPage();

      expect(screen.getByTestId('settings-page-theme-light')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-theme-dark')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-theme-system')).toBeInTheDocument();
    });

    it('should render language options', () => {
      renderSettingsPage();

      expect(screen.getByTestId('settings-page-language-en')).toBeInTheDocument();
      expect(screen.getByTestId('settings-page-language-zh')).toBeInTheDocument();
    });

    it('should change theme when theme option is clicked', async () => {
      renderSettingsPage();

      const darkThemeButton = screen.getByTestId('settings-page-theme-dark');
      fireEvent.click(darkThemeButton);

      await waitFor(() => {
        expect(useSettingsStore.getState().theme).toBe('dark');
      });
    });

    it('should change language when language option is clicked', async () => {
      renderSettingsPage();

      const zhLanguageButton = screen.getByTestId('settings-page-language-zh');
      fireEvent.click(zhLanguageButton);

      await waitFor(() => {
        expect(useSettingsStore.getState().language).toBe('zh');
      });
    });
  });

  describe('Provider Settings Integration', () => {
    it('should render ProviderSettings component in providers tab', () => {
      renderSettingsPage();

      const providersTab = screen.getByTestId('settings-page-tab-providers');
      fireEvent.click(providersTab);

      expect(screen.getByTestId('provider-settings')).toBeInTheDocument();
    });
  });

  describe('Model Selector Integration', () => {
    it('should render ModelSelector component in models tab', () => {
      renderSettingsPage();

      const modelsTab = screen.getByTestId('settings-page-tab-models');
      fireEvent.click(modelsTab);

      expect(screen.getByTestId('model-selector')).toBeInTheDocument();
    });
  });

  describe('MCP Server Settings Integration', () => {
    it('should render MCPServerSettings component in MCP servers tab', () => {
      renderSettingsPage();

      const mcpTab = screen.getByTestId('settings-page-tab-mcpServers');
      fireEvent.click(mcpTab);

      expect(screen.getByTestId('mcp-server-settings')).toBeInTheDocument();
    });
  });

  describe('Permission Settings Integration', () => {
    it('should render PermissionSettings component in permissions tab', () => {
      renderSettingsPage();

      const permissionsTab = screen.getByTestId('settings-page-tab-permissions');
      fireEvent.click(permissionsTab);

      expect(screen.getByTestId('permission-settings')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes for tabs', () => {
      renderSettingsPage();

      const tabs = screen.getByTestId('settings-page-tabs');
      expect(tabs).toHaveAttribute('role', 'tablist');

      const generalTab = screen.getByTestId('settings-page-tab-general');
      expect(generalTab).toHaveAttribute('role', 'tab');
      expect(generalTab).toHaveAttribute('aria-selected');
    });

    it('should have proper ARIA attributes for tab content', () => {
      renderSettingsPage();

      const content = screen.getByTestId('settings-page-content');
      expect(content).toHaveAttribute('role', 'tabpanel');
    });
  });
});
