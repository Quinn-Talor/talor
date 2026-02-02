/**
 * LanguageSelector Component Tests
 * 语言选择组件测试
 *
 * Tests for the LanguageSelector component.
 *
 * @requirements 10.2 - 允许用户切换界面语言
 * @property 25 - 国际化文本切换
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageSelector } from './LanguageSelector';
import { useSettingsStore } from '../../store/settings';

// Create hoisted mock for changeLanguage
const mockChangeLanguage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Mock react-i18next with initReactI18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.language.title': 'Language',
        'settings.language.description': 'Choose your preferred language',
      };
      return translations[key] || key;
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
}));

// Mock i18n module
vi.mock('../../i18n', () => ({
  changeLanguage: mockChangeLanguage,
  LANGUAGE_NAMES: {
    en: { native: 'English', english: 'English' },
    zh: { native: '中文', english: 'Chinese' },
  },
  SUPPORTED_LANGUAGES: ['en', 'zh'],
  DEFAULT_LANGUAGE: 'en',
  FALLBACK_LANGUAGE: 'en',
  isValidLanguage: (lang: string) => ['en', 'zh'].includes(lang),
  getCurrentLanguage: () => 'en',
  detectLanguage: () => 'en',
}));

describe('LanguageSelector', () => {
  beforeEach(() => {
    // Reset store state
    useSettingsStore.setState({
      theme: 'light',
      language: 'en',
      defaultModel: null,
      providers: [],
      mcpServers: [],
    });
    // Clear mock calls
    mockChangeLanguage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render selector button', () => {
      render(<LanguageSelector />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-label', 'Language');
    });

    it('should render with custom className', () => {
      render(<LanguageSelector className="custom-class" />);

      const container = screen.getByRole('button').parentElement;
      expect(container).toHaveClass('custom-class');
    });

    it('should render with label when showLabel is true', () => {
      render(<LanguageSelector showLabel />);

      expect(screen.getByText('English')).toBeInTheDocument();
    });

    it('should not render label by default', () => {
      render(<LanguageSelector />);

      expect(screen.queryByText('English')).not.toBeInTheDocument();
    });

    it('should show Chinese label when language is zh', () => {
      useSettingsStore.setState({ language: 'zh' });

      render(<LanguageSelector showLabel />);

      expect(screen.getByText('中文')).toBeInTheDocument();
    });
  });

  describe('dropdown behavior', () => {
    it('should open dropdown on click', () => {
      render(<LanguageSelector />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('should show description in dropdown', () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Choose your preferred language')).toBeInTheDocument();
    });

    it('should highlight current language option', () => {
      useSettingsStore.setState({ language: 'zh' });

      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));

      const zhOption = screen.getByRole('option', { name: /中文/i });
      expect(zhOption).toHaveAttribute('aria-selected', 'true');
    });

    it('should change language when option is clicked', async () => {
      useSettingsStore.setState({ language: 'en' });

      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /中文/i }));

      await waitFor(() => {
        expect(useSettingsStore.getState().language).toBe('zh');
      });
      expect(mockChangeLanguage).toHaveBeenCalledWith('zh');
    });

    it('should close dropdown after selection', async () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('option', { name: /中文/i }));
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('should close dropdown on Escape key', () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole('button').parentElement!, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', () => {
      render(
        <div>
          <LanguageSelector />
          <button data-testid="outside">Outside</button>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Language' }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Simulate mousedown outside
      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should call onLanguageChange callback', async () => {
      const onLanguageChange = vi.fn();

      render(<LanguageSelector onLanguageChange={onLanguageChange} />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /中文/i }));

      await waitFor(() => {
        expect(onLanguageChange).toHaveBeenCalledWith('zh');
      });
    });
  });

  describe('sizes', () => {
    it('should render small size', () => {
      render(<LanguageSelector size="sm" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-1.5');
    });

    it('should render medium size (default)', () => {
      render(<LanguageSelector size="md" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-2');
    });

    it('should render large size', () => {
      render(<LanguageSelector size="lg" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-2.5');
    });
  });

  describe('accessibility', () => {
    it('should have aria-label', () => {
      render(<LanguageSelector />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Language');
    });

    it('should have aria-haspopup', () => {
      render(<LanguageSelector />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('should have aria-expanded when dropdown is open', () => {
      render(<LanguageSelector />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('should support keyboard navigation with Enter', async () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));

      const zhOption = screen.getByRole('option', { name: /中文/i });
      fireEvent.keyDown(zhOption, { key: 'Enter' });

      await waitFor(() => {
        expect(useSettingsStore.getState().language).toBe('zh');
      });
    });

    it('should support keyboard navigation with Space', async () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));

      const zhOption = screen.getByRole('option', { name: /中文/i });
      fireEvent.keyDown(zhOption, { key: ' ' });

      await waitFor(() => {
        expect(useSettingsStore.getState().language).toBe('zh');
      });
    });

    it('should open dropdown with ArrowDown key', () => {
      render(<LanguageSelector />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button.parentElement!, { key: 'ArrowDown' });

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('language persistence', () => {
    it('should update settings store when language changes', async () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /中文/i }));

      await waitFor(() => {
        expect(useSettingsStore.getState().language).toBe('zh');
      });
    });

    it('should call i18n changeLanguage when language changes', async () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /中文/i }));

      await waitFor(() => {
        expect(mockChangeLanguage).toHaveBeenCalledWith('zh');
      });
    });

    it('should switch back to English', async () => {
      useSettingsStore.setState({ language: 'zh' });

      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('option', { name: /English/i }));

      await waitFor(() => {
        expect(useSettingsStore.getState().language).toBe('en');
      });
      expect(mockChangeLanguage).toHaveBeenCalledWith('en');
    });
  });

  describe('display options', () => {
    it('should show both native and English names for each language', () => {
      render(<LanguageSelector />);

      fireEvent.click(screen.getByRole('button'));

      // English option
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('(English)')).toBeInTheDocument();

      // Chinese option
      expect(screen.getByText('中文')).toBeInTheDocument();
      expect(screen.getByText('(Chinese)')).toBeInTheDocument();
    });
  });
});
