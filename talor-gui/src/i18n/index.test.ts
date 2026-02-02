/**
 * i18n Configuration Tests
 * 国际化配置测试
 *
 * Tests for the i18n configuration module.
 *
 * @requirements 10.1 - 支持中文和英文界面
 * @requirements 10.4 - 记住用户的语言偏好设置
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18n, {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  detectLanguage,
  isValidLanguage,
  changeLanguage,
  getCurrentLanguage,
  LANGUAGE_NAMES,
} from './index';

describe('i18n Configuration', () => {
  describe('Constants', () => {
    it('should have en and zh as supported languages', () => {
      expect(SUPPORTED_LANGUAGES).toContain('en');
      expect(SUPPORTED_LANGUAGES).toContain('zh');
      expect(SUPPORTED_LANGUAGES).toHaveLength(2);
    });

    it('should have en as default language', () => {
      expect(DEFAULT_LANGUAGE).toBe('en');
    });

    it('should have en as fallback language', () => {
      expect(FALLBACK_LANGUAGE).toBe('en');
    });

    it('should use correct storage key', () => {
      expect(LANGUAGE_STORAGE_KEY).toBe('talor-gui-settings');
    });

    it('should have language names for all supported languages', () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(LANGUAGE_NAMES[lang]).toBeDefined();
        expect(LANGUAGE_NAMES[lang].native).toBeDefined();
        expect(LANGUAGE_NAMES[lang].english).toBeDefined();
      }
    });
  });

  describe('isValidLanguage', () => {
    it('should return true for supported languages', () => {
      expect(isValidLanguage('en')).toBe(true);
      expect(isValidLanguage('zh')).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      expect(isValidLanguage('fr')).toBe(false);
      expect(isValidLanguage('de')).toBe(false);
      expect(isValidLanguage('')).toBe(false);
      expect(isValidLanguage('invalid')).toBe(false);
    });
  });

  describe('detectLanguage', () => {
    const originalLocalStorage = global.localStorage;
    const originalNavigator = global.navigator;

    beforeEach(() => {
      // Reset localStorage mock
      const localStorageMock = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };
      Object.defineProperty(global, 'localStorage', {
        value: localStorageMock,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(global, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
      });
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true,
      });
    });

    it('should detect language from localStorage', () => {
      const mockStorage = {
        getItem: vi.fn().mockReturnValue(JSON.stringify({ state: { language: 'zh' } })),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };
      Object.defineProperty(global, 'localStorage', {
        value: mockStorage,
        writable: true,
      });

      expect(detectLanguage()).toBe('zh');
    });

    it('should detect language from browser when localStorage is empty', () => {
      const mockStorage = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };
      Object.defineProperty(global, 'localStorage', {
        value: mockStorage,
        writable: true,
      });

      Object.defineProperty(global, 'navigator', {
        value: { language: 'zh-CN' },
        writable: true,
      });

      expect(detectLanguage()).toBe('zh');
    });

    it('should fallback to default language when browser language is not supported', () => {
      const mockStorage = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };
      Object.defineProperty(global, 'localStorage', {
        value: mockStorage,
        writable: true,
      });

      Object.defineProperty(global, 'navigator', {
        value: { language: 'fr-FR' },
        writable: true,
      });

      expect(detectLanguage()).toBe(DEFAULT_LANGUAGE);
    });

    it('should handle invalid localStorage data gracefully', () => {
      const mockStorage = {
        getItem: vi.fn().mockReturnValue('invalid json'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };
      Object.defineProperty(global, 'localStorage', {
        value: mockStorage,
        writable: true,
      });

      Object.defineProperty(global, 'navigator', {
        value: { language: 'en-US' },
        writable: true,
      });

      // Should not throw and should fallback
      expect(detectLanguage()).toBe('en');
    });
  });

  describe('changeLanguage', () => {
    it('should change language to a valid language', async () => {
      await changeLanguage('zh');
      expect(i18n.language).toBe('zh');

      await changeLanguage('en');
      expect(i18n.language).toBe('en');
    });

    it('should fallback when given invalid language', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // @ts-expect-error Testing invalid input
      await changeLanguage('invalid');

      expect(consoleSpy).toHaveBeenCalled();
      expect(i18n.language).toBe(FALLBACK_LANGUAGE);

      consoleSpy.mockRestore();
    });
  });

  describe('getCurrentLanguage', () => {
    it('should return the current language', async () => {
      await changeLanguage('en');
      expect(getCurrentLanguage()).toBe('en');

      await changeLanguage('zh');
      expect(getCurrentLanguage()).toBe('zh');
    });
  });

  describe('i18n instance', () => {
    it('should be initialized', () => {
      expect(i18n.isInitialized).toBe(true);
    });

    it('should have correct fallback language', () => {
      expect(i18n.options.fallbackLng).toContain(FALLBACK_LANGUAGE);
    });

    it('should have correct supported languages', () => {
      expect(i18n.options.supportedLngs).toEqual(
        expect.arrayContaining([...SUPPORTED_LANGUAGES])
      );
    });

    it('should not escape values (React handles this)', () => {
      expect(i18n.options.interpolation?.escapeValue).toBe(false);
    });

    it('should have translation namespace as default', () => {
      expect(i18n.options.defaultNS).toBe('translation');
    });
  });
});
