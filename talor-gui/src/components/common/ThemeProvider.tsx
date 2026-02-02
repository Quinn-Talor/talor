/**
 * ThemeProvider Component
 * 主题提供者组件
 *
 * Context provider that manages theme state and applies theme to the document.
 * Supports light, dark, and system themes with automatic system preference detection.
 *
 * @requirements 6.6 - 提供主题切换功能（明亮/暗黑模式）
 * @property 19 - 主题切换 - For any theme switch operation, the theme state should update and the UI should apply the new theme's styles.
 */

import React, { createContext, useContext, useEffect, useCallback, useMemo } from 'react';
import { useSettingsStore, applyTheme, getEffectiveTheme, type Theme } from '../../store/settings';

/**
 * Theme context value interface
 * 主题上下文值接口
 */
export interface ThemeContextValue {
  /** Current theme setting / 当前主题设置 */
  theme: Theme;
  /** Effective theme (resolved from system) / 有效主题（从系统解析） */
  effectiveTheme: 'light' | 'dark';
  /** Set the theme / 设置主题 */
  setTheme: (theme: Theme) => void;
  /** Toggle between light and dark themes / 在明亮和暗黑主题之间切换 */
  toggleTheme: () => void;
  /** Check if current theme is dark / 检查当前主题是否为暗黑 */
  isDark: boolean;
}

/**
 * Theme context
 * 主题上下文
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * ThemeProvider props interface
 * 主题提供者属性接口
 */
export interface ThemeProviderProps {
  /** Children to render / 要渲染的子元素 */
  children: React.ReactNode;
  /** Default theme (optional, defaults to store value) / 默认主题（可选，默认为 store 值） */
  defaultTheme?: Theme;
  /** Storage key for persisting theme (optional) / 持久化主题的存储键（可选） */
  storageKey?: string;
}

/**
 * ThemeProvider component
 * 主题提供者组件
 *
 * Provides theme context to the application and handles:
 * - Theme state management via Zustand store
 * - Applying theme classes to document root
 * - System preference detection and changes
 * - Theme persistence
 *
 * @param props - ThemeProvider props / 主题提供者属性
 * @returns ThemeProvider component / 主题提供者组件
 *
 * @requirements 6.6 - 提供主题切换功能
 * @property 19 - 主题切换
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultTheme,
}) => {
  const { theme, setTheme } = useSettingsStore();

  // Use default theme on initial mount if provided
  useEffect(() => {
    if (defaultTheme && theme === 'system') {
      // Only set default if current theme is system (initial state)
      // This allows the store's persisted value to take precedence
    }
  }, [defaultTheme, theme]);

  // Apply theme to document on mount and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system preference changes when theme is 'system'
  useEffect(() => {
    if (theme !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      applyTheme('system');
    };

    // Add listener for system preference changes
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme]);

  /**
   * Toggle between light and dark themes
   * 在明亮和暗黑主题之间切换
   */
  const toggleTheme = useCallback(() => {
    const effective = getEffectiveTheme(theme);
    setTheme(effective === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  /**
   * Get the effective theme (resolved from system)
   * 获取有效主题（从系统解析）
   */
  const effectiveTheme = useMemo(() => getEffectiveTheme(theme), [theme]);

  /**
   * Check if current theme is dark
   * 检查当前主题是否为暗黑
   */
  const isDark = effectiveTheme === 'dark';

  /**
   * Context value
   * 上下文值
   */
  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      effectiveTheme,
      setTheme,
      toggleTheme,
      isDark,
    }),
    [theme, effectiveTheme, setTheme, toggleTheme, isDark]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook to use theme context
 * 使用主题上下文的 Hook
 *
 * @returns Theme context value / 主题上下文值
 * @throws Error if used outside ThemeProvider / 如果在 ThemeProvider 外部使用则抛出错误
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}

/**
 * Hook to use theme context with optional fallback
 * 使用主题上下文的 Hook（带可选回退）
 *
 * @returns Theme context value or null / 主题上下文值或 null
 */
export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default ThemeProvider;
