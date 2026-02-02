/**
 * ThemeToggle Component Tests
 * 主题切换组件测试
 *
 * Tests for the ThemeToggle, ThemeToggleButton, and ThemeDropdown components.
 *
 * @requirements 6.6 - 提供主题切换功能（明亮/暗黑模式）
 * @property 19 - 主题切换
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ThemeToggle, ThemeToggleButton, ThemeDropdown } from './ThemeToggle';
import { ThemeProvider } from './ThemeProvider';
import { useSettingsStore } from '../../store/settings';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.theme.title': 'Theme',
        'settings.theme.light': 'Light',
        'settings.theme.dark': 'Dark',
        'settings.theme.system': 'System',
        'settings.theme.description': 'Choose your preferred color theme',
      };
      return translations[key] || key;
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}));

describe('ThemeToggle', () => {
  // Mock matchMedia
  const mockMatchMedia = vi.fn();
  const mockAddEventListener = vi.fn();
  const mockRemoveEventListener = vi.fn();

  beforeEach(() => {
    // Reset store state
    useSettingsStore.setState({
      theme: 'light',
      language: 'en',
      defaultModel: null,
      providers: [],
      mcpServers: [],
    });

    // Mock matchMedia
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    });
    window.matchMedia = mockMatchMedia;

    // Mock document.documentElement
    document.documentElement.classList.remove('dark', 'light');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render toggle button', () => {
      render(<ThemeToggle />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-label', 'Theme');
    });

    it('should render with custom className', () => {
      render(<ThemeToggle className="custom-class" />);

      const container = screen.getByRole('button').parentElement;
      expect(container).toHaveClass('custom-class');
    });

    it('should render with label when showLabel is true', () => {
      render(<ThemeToggle showLabel />);

      expect(screen.getByText('Light')).toBeInTheDocument();
    });

    it('should not render label by default', () => {
      render(<ThemeToggle />);

      expect(screen.queryByText('Light')).not.toBeInTheDocument();
    });
  });

  describe('dropdown variant', () => {
    it('should open dropdown on click', async () => {
      render(<ThemeToggle variant="dropdown" />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('should show description in dropdown', async () => {
      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Choose your preferred color theme')).toBeInTheDocument();
    });

    it('should highlight current theme option', async () => {
      useSettingsStore.setState({ theme: 'dark' });

      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));

      const darkOption = screen.getByRole('option', { name: /Dark/i });
      expect(darkOption).toHaveAttribute('aria-selected', 'true');
    });

    it('should change theme when option is clicked', async () => {
      useSettingsStore.setState({ theme: 'light' });

      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /Dark/i }));

      expect(useSettingsStore.getState().theme).toBe('dark');
    });

    it('should close dropdown after selection', async () => {
      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('option', { name: /Dark/i }));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should close dropdown on Escape key', async () => {
      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole('button').parentElement!, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', async () => {
      render(
        <div>
          <ThemeToggle variant="dropdown" />
          <button data-testid="outside">Outside</button>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Simulate mousedown outside
      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should call onThemeChange callback', async () => {
      const onThemeChange = vi.fn();

      render(<ThemeToggle variant="dropdown" onThemeChange={onThemeChange} />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /Dark/i }));

      expect(onThemeChange).toHaveBeenCalledWith('dark');
    });
  });

  describe('button variant', () => {
    it('should toggle between light and dark on click', async () => {
      useSettingsStore.setState({ theme: 'light' });

      render(<ThemeToggle variant="button" />);

      fireEvent.click(screen.getByRole('button'));
      expect(useSettingsStore.getState().theme).toBe('dark');

      fireEvent.click(screen.getByRole('button'));
      expect(useSettingsStore.getState().theme).toBe('light');
    });

    it('should not open dropdown', async () => {
      render(<ThemeToggle variant="button" />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should call onThemeChange callback', async () => {
      const onThemeChange = vi.fn();
      useSettingsStore.setState({ theme: 'light' });

      render(<ThemeToggle variant="button" onThemeChange={onThemeChange} />);

      fireEvent.click(screen.getByRole('button'));

      expect(onThemeChange).toHaveBeenCalledWith('dark');
    });
  });

  describe('sizes', () => {
    it('should render small size', () => {
      render(<ThemeToggle size="sm" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-1.5');
    });

    it('should render medium size (default)', () => {
      render(<ThemeToggle size="md" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-2');
    });

    it('should render large size', () => {
      render(<ThemeToggle size="lg" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-2.5');
    });
  });

  describe('accessibility', () => {
    it('should have aria-label', () => {
      render(<ThemeToggle />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Theme');
    });

    it('should have aria-haspopup for dropdown variant', () => {
      render(<ThemeToggle variant="dropdown" />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('should not have aria-haspopup for button variant', () => {
      render(<ThemeToggle variant="button" />);

      expect(screen.getByRole('button')).not.toHaveAttribute('aria-haspopup');
    });

    it('should have aria-expanded when dropdown is open', async () => {
      render(<ThemeToggle variant="dropdown" />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('should support keyboard navigation with Enter', async () => {
      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));
      
      const darkOption = screen.getByRole('option', { name: /Dark/i });
      fireEvent.keyDown(darkOption, { key: 'Enter' });

      expect(useSettingsStore.getState().theme).toBe('dark');
    });

    it('should support keyboard navigation with Space', async () => {
      render(<ThemeToggle variant="dropdown" />);

      fireEvent.click(screen.getByRole('button'));
      
      const darkOption = screen.getByRole('option', { name: /Dark/i });
      fireEvent.keyDown(darkOption, { key: ' ' });

      expect(useSettingsStore.getState().theme).toBe('dark');
    });
  });

  describe('with ThemeProvider', () => {
    it('should work correctly with ThemeProvider', async () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeToggle variant="dropdown" />
        </ThemeProvider>
      );

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /Dark/i }));

      expect(useSettingsStore.getState().theme).toBe('dark');
    });
  });
});

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'light',
      language: 'en',
      defaultModel: null,
      providers: [],
      mcpServers: [],
    });

    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('should render as button variant', async () => {
    render(<ThemeToggleButton />);

    fireEvent.click(screen.getByRole('button'));

    // Should toggle, not open dropdown
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useSettingsStore.getState().theme).toBe('dark');
  });
});

describe('ThemeDropdown', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'light',
      language: 'en',
      defaultModel: null,
      providers: [],
      mcpServers: [],
    });

    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('should render as dropdown variant', async () => {
    render(<ThemeDropdown />);

    fireEvent.click(screen.getByRole('button'));

    // Should open dropdown
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
