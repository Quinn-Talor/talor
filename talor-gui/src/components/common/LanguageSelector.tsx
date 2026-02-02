/**
 * LanguageSelector Component
 * 语言选择组件
 *
 * Dropdown component to switch between supported languages (English and Chinese).
 * Provides a dropdown menu for language selection with persistence.
 *
 * @requirements 10.2 - 允许用户切换界面语言
 * @property 25 - 国际化文本切换 - For any language switch operation, all interface text should update to the target language's translation, and the language preference should be persisted.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type Language } from '../../store/settings';
import { changeLanguage, LANGUAGE_NAMES, type SupportedLanguage } from '../../i18n';

/**
 * Globe icon component for language selector
 * 语言选择器的地球图标组件
 */
const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
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
 * LanguageSelector props interface
 * 语言选择器属性接口
 */
export interface LanguageSelectorProps {
  /** Size of the selector / 选择器的大小 */
  size?: 'sm' | 'md' | 'lg';
  /** Custom class name / 自定义类名 */
  className?: string;
  /** Show label text / 显示标签文本 */
  showLabel?: boolean;
  /** Callback when language changes / 语言变化时的回调 */
  onLanguageChange?: (language: Language) => void;
}

/**
 * Language option interface
 * 语言选项接口
 */
interface LanguageOption {
  value: Language;
  native: string;
  english: string;
}

/**
 * Available language options
 * 可用的语言选项
 */
const languageOptions: LanguageOption[] = [
  { value: 'en', native: LANGUAGE_NAMES.en.native, english: LANGUAGE_NAMES.en.english },
  { value: 'zh', native: LANGUAGE_NAMES.zh.native, english: LANGUAGE_NAMES.zh.english },
];

/**
 * Size classes for the selector button
 * 选择器按钮的大小类
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
 * LanguageSelector component
 * 语言选择组件
 *
 * Provides a dropdown to switch between supported languages.
 *
 * @param props - LanguageSelector props / 语言选择器属性
 * @returns LanguageSelector component / 语言选择组件
 *
 * @requirements 10.2 - 允许用户切换界面语言
 * @property 25 - 国际化文本切换
 */
export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  size = 'md',
  className = '',
  showLabel = false,
  onLanguageChange,
}) => {
  const { t } = useTranslation();
  const { language, setLanguage } = useSettingsStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /**
   * Handle language change
   * 处理语言变化
   */
  const handleLanguageChange = useCallback(
    async (newLanguage: Language) => {
      // Update i18next language
      await changeLanguage(newLanguage as SupportedLanguage);
      // Update settings store (persists to localStorage)
      setLanguage(newLanguage);
      // Call callback if provided
      onLanguageChange?.(newLanguage);
      // Close dropdown
      setIsOpen(false);
    },
    [setLanguage, onLanguageChange]
  );

  /**
   * Toggle dropdown
   * 切换下拉菜单
   */
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

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
    (event: React.KeyboardEvent, languageValue: Language) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleLanguageChange(languageValue);
      }
    },
    [handleLanguageChange]
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

  // Get current language option
  const currentOption = languageOptions.find((opt) => opt.value === language);

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
        aria-label={t('settings.language.title')}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={t('settings.language.title')}
      >
        <GlobeIcon className={iconSizeClasses[size]} />
        {showLabel && (
          <span className="ml-2 text-sm font-medium">
            {currentOption?.native ?? t('settings.language.title')}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
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
          aria-label={t('settings.language.title')}
        >
          {/* Language description */}
          <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            {t('settings.language.description')}
          </div>

          {/* Language options */}
          {languageOptions.map((option) => {
            const isSelected = language === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleLanguageChange(option.value)}
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
                <span className="flex-1">
                  <span className="font-medium">{option.native}</span>
                  <span className="ml-2 text-gray-500 dark:text-gray-400">
                    ({option.english})
                  </span>
                </span>
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
 * Default export for convenience
 * 默认导出以方便使用
 */
export default LanguageSelector;
