/**
 * i18n Configuration
 * 国际化配置
 *
 * Initializes i18next with react-i18next for internationalization support.
 * Configures language detection, persistence, and fallback behavior.
 *
 * @requirements 10.1 - 支持中文和英文界面
 * @requirements 10.4 - 记住用户的语言偏好设置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { zh } from './zh';

/**
 * Supported languages
 * 支持的语言
 */
export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;

/**
 * Language type
 * 语言类型
 */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Default language
 * 默认语言
 */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/**
 * Fallback language
 * 回退语言
 */
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/**
 * LocalStorage key for language preference
 * 语言偏好的 localStorage 键
 */
export const LANGUAGE_STORAGE_KEY = 'talor-gui-settings';

/**
 * Detects the user's preferred language
 * 检测用户的首选语言
 *
 * Detection order:
 * 1. localStorage (persisted preference)
 * 2. Browser language (navigator.language)
 * 3. Fallback to default language
 *
 * @returns The detected language / 检测到的语言
 */
export function detectLanguage(): SupportedLanguage {
  // 1. Check localStorage for persisted preference
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.state?.language && isValidLanguage(parsed.state.language)) {
          return parsed.state.language;
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // 2. Check browser language
  if (typeof navigator !== 'undefined' && navigator.language) {
    const browserLang = navigator.language.split('-')[0];
    if (isValidLanguage(browserLang)) {
      return browserLang;
    }
  }

  // 3. Fallback to default language
  return DEFAULT_LANGUAGE;
}

/**
 * Checks if a language code is valid
 * 检查语言代码是否有效
 *
 * @param lang - The language code to check / 要检查的语言代码
 * @returns True if the language is supported / 如果语言受支持则返回 true
 */
export function isValidLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

/**
 * Changes the current language
 * 更改当前语言
 *
 * @param language - The language to change to / 要更改为的语言
 * @returns Promise that resolves when the language is changed / 语言更改完成时解析的 Promise
 */
export async function changeLanguage(language: SupportedLanguage): Promise<void> {
  if (!isValidLanguage(language)) {
    console.warn(`Invalid language: ${language}. Using fallback: ${FALLBACK_LANGUAGE}`);
    language = FALLBACK_LANGUAGE;
  }
  await i18n.changeLanguage(language);
}

/**
 * Gets the current language
 * 获取当前语言
 *
 * @returns The current language / 当前语言
 */
export function getCurrentLanguage(): SupportedLanguage {
  const lang = i18n.language;
  if (isValidLanguage(lang)) {
    return lang;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Language display names
 * 语言显示名称
 */
export const LANGUAGE_NAMES: Record<SupportedLanguage, { native: string; english: string }> = {
  en: { native: 'English', english: 'English' },
  zh: { native: '中文', english: 'Chinese' },
};

/**
 * Translation resources populated from translation files
 * 从翻译文件填充的翻译资源
 *
 * @requirements 10.1 - 支持中文和英文界面
 */
const resources = {
  en: {
    translation: en,
  },
  zh: {
    translation: zh,
  },
};

/**
 * Initialize i18next
 * 初始化 i18next
 *
 * @requirements 10.1 - 支持中文和英文界面
 * @requirements 10.4 - 记住用户的语言偏好设置
 */
i18n
  .use(initReactI18next)
  .init({
    // Resources (translations)
    resources,

    // Detected language or fallback
    lng: detectLanguage(),

    // Fallback language when translation is missing
    fallbackLng: FALLBACK_LANGUAGE,

    // Supported languages
    supportedLngs: SUPPORTED_LANGUAGES,

    // Interpolation settings
    interpolation: {
      // React already escapes values
      escapeValue: false,
    },

    // React settings
    react: {
      // Use Suspense for loading translations
      useSuspense: false,
    },

    // Debug mode (disabled in production)
    debug: import.meta.env.DEV,

    // Key separator for nested translations
    keySeparator: '.',

    // Namespace separator
    nsSeparator: ':',

    // Default namespace
    defaultNS: 'translation',

    // Return empty string for missing keys in development
    returnEmptyString: false,

    // Return key if translation is missing
    returnNull: false,
  });

/**
 * Export the configured i18n instance
 * 导出配置好的 i18n 实例
 */
export default i18n;
