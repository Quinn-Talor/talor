/**
 * ThemeToggle Component
 * 主题切换组件
 *
 * Button/dropdown component to switch between light, dark, and system themes.
 * Provides both a simple toggle button and a dropdown menu for theme selection.
 *
 * @requirements 6.6 - 提供主题切换功能（明亮/暗黑模式）
 * @property 19 - 主题切换 - For any theme switch operation, the theme state should update and the UI should apply the new theme's styles.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type Theme } from '../../store/settings';
import { useThemeOptional } from './ThemeProvider';

/**
 * Sun icon component for light theme
 * 浅色主题的太阳图标组件
 */
const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

/**
 * Moon icon component for dark theme
 * 深色主题的月亮图标组件
 */
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
    />
  </svg>
);

/**
 * Computer/System icon component for system theme
 * 系统主题的电脑图标组件
 */
const SystemIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
    />
  </svg>
);

/**
 * Check icon component for selected item
 * 选中项的勾选图标组件
 */
const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 13l4 4L19 7"
    />
  </svg>
);

/**
 * ThemeToggle props interface
 * 主题切换属性接口
 */
export interface ThemeToggleProps {
  /** Variant of the toggle / 切换的变体 */
  variant?: 'button' | 'dropdown';
  /** Size of the toggle / 切换的大小 */
  size?: 'sm' | 'md' | 'lg';
  /** Custom class name / 自定义类名 */
  className?: string;
  /** Show label text / 显示标签文本 */
  showLabel?: boolean;
  /** Callback when theme changes / 主题变化时的回调 */
  onThemeChange?: (theme: Theme) => void;
}

/**
 * Theme option interface
 * 主题选项接口
 */
interface ThemeOption {
  value: Theme;
  labelKey: string;
  icon: React.FC<{ className?: string }>;
}

/**
 * Available theme options
 * 可用的主题选项
 */
const themeOptions: ThemeOption[] = [
  { value: 'light', labelKey: 'settings.theme.light', icon: SunIcon },
  { value: 'dark', labelKey: 'settings.theme.dark', icon: MoonIcon },
  { value: 'system', labelKey: 'settings.theme.system', icon: SystemIcon },
];

/**
 * Size classes for the toggle button
 * 切换按钮的大小类
 */
const sizeClasses = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-2.5',
};

/**
 * Icon size classes
 * 图标大小类
 */
const iconSizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

/**
 * ThemeToggle component
 * 主题切换组件
 *
 * Provides a button or dropdown to switch between themes.
 *
 * @param props - ThemeToggle props / 主题切换属性
 * @returns ThemeToggle component / 主题切换组件
 *
 * @requirements 6.6 - 提供主题切换功能
 * @property 19 - 主题切换
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  variant = 'dropdown',
  size = 'md',
  className = '',
  showLabel = false,
  onThemeChange,
}) => {
  const { t } = useTranslation();
  const { theme, setTheme } = useSettingsStore();
  const themeContext = useThemeOptional();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Get effective theme from context or calculate it
  const effectiveTheme = themeContext?.effectiveTheme ?? 
    (theme === 'system' 
      ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme);

  /**
   * Handle theme change
   * 处理主题变化
   */
  const handleThemeChange = useCallback(
    (newTheme: Theme) => {
      setTheme(newTheme);
      onThemeChange?.(newTheme);
      setIsOpen(false);
    },
    [setTheme, onThemeChange]
  );

  /**
   * Toggle dropdown
   * 切换下拉菜单
   */
  const handleToggle = useCallback(() => {
    if (variant === 'button') {
      // Simple toggle between light and dark
      const newTheme = effectiveTheme === 'dark' ? 'light' : 'dark';
      handleThemeChange(newTheme);
    } else {
      setIsOpen((prev) => !prev);
    }
  }, [variant, effectiveTheme, handleThemeChange]);

  /**
   * Handle keyboard navigation
   * 处理键盘导航
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      } else if (event.key === 'ArrowDown' && !isOpen) {
        setIsOpen(true);
      }
    },
    [isOpen]
  );

  /**
   * Handle option keyboard navigation
   * 处理选项键盘导航
   */
  const handleOptionKeyDown = useCallback(
    (event: React.KeyboardEvent, themeValue: Theme) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleThemeChange(themeValue);
      }
    },
    [handleThemeChange]
  );

  /**
   * Close dropdown when clicking outside
   * 点击外部时关闭下拉菜单
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Get current theme icon
  const CurrentIcon = effectiveTheme === 'dark' ? MoonIcon : SunIcon;
  const currentOption = themeOptions.find((opt) => opt.value === theme);

  return (
    <div
      ref={dropdownRef}
      className={`relative inline-block ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Toggle Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`
          inline-flex items-center justify-center
          ${sizeClasses[size]}
          rounded-lg
          text-gray-500 dark:text-gray-400
          hover:bg-gray-100 dark:hover:bg-gray-700
          hover:text-gray-700 dark:hover:text-gray-200
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          dark:focus:ring-offset-gray-800
          transition-colors duration-200
        `}
        aria-label={t('settings.theme.title')}
        aria-haspopup={variant === 'dropdown' ? 'listbox' : undefined}
        aria-expanded={variant === 'dropdown' ? isOpen : undefined}
        title={t('settings.theme.title')}
      >
        <CurrentIcon className={iconSizeClasses[size]} />
        {showLabel && (
          <span className="ml-2 text-sm font-medium">
            {currentOption ? t(currentOption.labelKey) : t('settings.theme.title')}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {variant === 'dropdown' && isOpen && (
        <div
          className="
            absolute right-0 z-50 mt-2
            min-w-[160px]
            bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg
            py-1
            animate-in fade-in-0 zoom-in-95
          "
          role="listbox"
          aria-label={t('settings.theme.title')}
        >
          {/* Theme description */}
          <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            {t('settings.theme.description')}
          </div>

          {/* Theme options */}
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleThemeChange(option.value)}
                onKeyDown={(e) => handleOptionKeyDown(e, option.value)}
                className={`
                  w-full flex items-center px-3 py-2
                  text-sm text-left
                  ${isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                  transition-colors duration-150
                `}
                role="option"
                aria-selected={isSelected}
              >
                <Icon className="w-4 h-4 mr-3 flex-shrink-0" />
                <span className="flex-1">{t(option.labelKey)}</span>
                {isSelected && (
                  <CheckIcon className="w-4 h-4 ml-2 text-blue-600 dark:text-blue-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Simple theme toggle button (light/dark only)
 * 简单的主题切换按钮（仅明亮/暗黑）
 */
export const ThemeToggleButton: React.FC<Omit<ThemeToggleProps, 'variant'>> = (props) => (
  <ThemeToggle {...props} variant="button" />
);

/**
 * Theme dropdown selector
 * 主题下拉选择器
 */
export const ThemeDropdown: React.FC<Omit<ThemeToggleProps, 'variant'>> = (props) => (
  <ThemeToggle {...props} variant="dropdown" />
);

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default ThemeToggle;
