/**
 * ThemeProvider Component Tests
 * 主题提供者组件测试
 *
 * Tests for the ThemeProvider component and useTheme hook.
 *
 * @requirements 6.6 - 提供主题切换功能（明亮/暗黑模式）
 * @property 19 - 主题切换
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, useThemeOptional } from './ThemeProvider';
import { useSettingsStore } from '../../store/settings';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}));

// Helper component to test useTheme hook
const ThemeConsumer: React.FC = () => {
  const { theme, effectiveTheme, isDark, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="effective-theme">{effectiveTheme}</span>
      <span data-testid="is-dark">{isDark.toString()}</span>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        Set Light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        Set Dark
      </button>
      <button data-testid="set-system" onClick={() => setTheme('system')}>
        Set System
      </button>
      <button data-testid="toggle" onClick={toggleTheme}>
        Toggle
      </button>
    </div>
  );
};

// Helper component to test useThemeOptional hook
const OptionalThemeConsumer: React.FC = () => {
  const context = useThemeOptional();
  return (
    <div>
      <span data-testid="has-context">{(context !== null).toString()}</span>
      {context && <span data-testid="optional-theme">{context.theme}</span>}
    </div>
  );
};

describe('ThemeProvider', () => {
  // Mock matchMedia
  const mockMatchMedia = vi.fn();
  const mockAddEventListener = vi.fn();
  const mockRemoveEventListener = vi.fn();

  beforeEach(() => {
    // Reset store state
    useSettingsStore.setState({
      theme: 'system',
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
    it('should render children', () => {
      render(
        <ThemeProvider>
          <div data-testid="child">Child content</div>
        </ThemeProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByTestId('child')).toHaveTextContent('Child content');
    });

    it('should provide theme context to children', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toBeInTheDocument();
      expect(screen.getByTestId('effective-theme')).toBeInTheDocument();
      expect(screen.getByTestId('is-dark')).toBeInTheDocument();
    });
  });

  describe('theme state', () => {
    it('should provide initial theme from store', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('should provide effective theme for light', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('effective-theme')).toHaveTextContent('light');
      expect(screen.getByTestId('is-dark')).toHaveTextContent('false');
    });

    it('should provide effective theme for dark', () => {
      useSettingsStore.setState({ theme: 'dark' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('effective-theme')).toHaveTextContent('dark');
      expect(screen.getByTestId('is-dark')).toHaveTextContent('true');
    });

    it('should resolve system theme to light when system prefers light', () => {
      mockMatchMedia.mockReturnValue({
        matches: false, // prefers-color-scheme: dark is false
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      });
      useSettingsStore.setState({ theme: 'system' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('system');
      expect(screen.getByTestId('effective-theme')).toHaveTextContent('light');
      expect(screen.getByTestId('is-dark')).toHaveTextContent('false');
    });

    it('should resolve system theme to dark when system prefers dark', () => {
      mockMatchMedia.mockReturnValue({
        matches: true, // prefers-color-scheme: dark is true
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      });
      useSettingsStore.setState({ theme: 'system' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('system');
      expect(screen.getByTestId('effective-theme')).toHaveTextContent('dark');
      expect(screen.getByTestId('is-dark')).toHaveTextContent('true');
    });
  });

  describe('setTheme', () => {
    it('should update theme to light', () => {
      useSettingsStore.setState({ theme: 'dark' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-light').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(useSettingsStore.getState().theme).toBe('light');
    });

    it('should update theme to dark', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-dark').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(useSettingsStore.getState().theme).toBe('dark');
    });

    it('should update theme to system', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-system').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('system');
      expect(useSettingsStore.getState().theme).toBe('system');
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from light to dark', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('toggle').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('should toggle from dark to light', () => {
      useSettingsStore.setState({ theme: 'dark' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('toggle').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('should toggle from system (light) to dark', () => {
      mockMatchMedia.mockReturnValue({
        matches: false, // system prefers light
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      });
      useSettingsStore.setState({ theme: 'system' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('toggle').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('should toggle from system (dark) to light', () => {
      mockMatchMedia.mockReturnValue({
        matches: true, // system prefers dark
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      });
      useSettingsStore.setState({ theme: 'system' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('toggle').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });
  });

  describe('system preference listener', () => {
    it('should add listener when theme is system', () => {
      useSettingsStore.setState({ theme: 'system' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should not add listener when theme is not system', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(mockAddEventListener).not.toHaveBeenCalled();
    });

    it('should remove listener on unmount', () => {
      useSettingsStore.setState({ theme: 'system' });

      const { unmount } = render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      unmount();

      expect(mockRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('document class application', () => {
    it('should apply light class for light theme', () => {
      useSettingsStore.setState({ theme: 'light' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should apply dark class for dark theme', () => {
      useSettingsStore.setState({ theme: 'dark' });

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });
  });
});

describe('useTheme', () => {
  it('should throw error when used outside ThemeProvider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const TestComponent: React.FC = () => {
      useTheme();
      return null;
    };

    expect(() => render(<TestComponent />)).toThrow(
      'useTheme must be used within a ThemeProvider'
    );

    consoleSpy.mockRestore();
  });
});

describe('useThemeOptional', () => {
  it('should return null when used outside ThemeProvider', () => {
    render(<OptionalThemeConsumer />);

    expect(screen.getByTestId('has-context')).toHaveTextContent('false');
  });

  it('should return context when used inside ThemeProvider', () => {
    useSettingsStore.setState({ theme: 'dark' });

    render(
      <ThemeProvider>
        <OptionalThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('has-context')).toHaveTextContent('true');
    expect(screen.getByTestId('optional-theme')).toHaveTextContent('dark');
  });
});
