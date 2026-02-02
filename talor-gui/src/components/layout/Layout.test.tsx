/**
 * Layout Component Tests
 * 布局组件测试
 *
 * Tests for the Layout component including:
 * - Rendering with children
 * - Sidebar visibility and toggle
 * - Responsive behavior
 * - Theme support
 *
 * @requirements 9.1 - 在桌面浏览器中提供侧边栏和主内容区的双栏布局
 * @requirements 9.2 - 屏幕宽度小于断点时切换为单栏布局并隐藏侧边栏
 * @requirements 9.3 - 支持侧边栏的展开和折叠
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Layout } from './Layout';
import { useUIStore } from '../../store/ui';
import { useSettingsStore } from '../../store/settings';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'nav.sidebar.toggle': 'Toggle Sidebar',
        'nav.sidebar.expand': 'Expand Sidebar',
        'nav.sidebar.collapse': 'Collapse Sidebar',
        'session.title': 'Sessions',
        'common.close': 'Close',
        'a11y.sessionList': 'Session list',
        'a11y.chatArea': 'Chat area',
      };
      return translations[key] || key;
    },
  }),
}));

// Helper to reset stores before each test
const resetStores = () => {
  useUIStore.getState().resetUIState();
  useSettingsStore.getState().resetSettings();
};

// Helper to mock window.innerWidth
const mockWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
};

describe('Layout', () => {
  beforeEach(() => {
    resetStores();
    // Default to desktop width
    mockWindowWidth(1024);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render children content', () => {
      render(
        <Layout>
          <div data-testid="main-content">Main Content</div>
        </Layout>
      );

      expect(screen.getByTestId('main-content')).toBeInTheDocument();
      expect(screen.getByText('Main Content')).toBeInTheDocument();
    });

    it('should render sidebar when provided', () => {
      render(
        <Layout sidebar={<div data-testid="sidebar-content">Sidebar</div>}>
          <div>Main</div>
        </Layout>
      );

      expect(screen.getByTestId('sidebar-content')).toBeInTheDocument();
    });

    it('should render header when provided', () => {
      render(
        <Layout header={<div data-testid="header-content">Header</div>}>
          <div>Main</div>
        </Layout>
      );

      expect(screen.getByTestId('header-content')).toBeInTheDocument();
    });

    it('should render footer when provided', () => {
      render(
        <Layout footer={<div data-testid="footer-content">Footer</div>}>
          <div>Main</div>
        </Layout>
      );

      expect(screen.getByTestId('footer-content')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <Layout className="custom-class">
          <div>Main</div>
        </Layout>
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Sidebar Toggle (Desktop)', () => {
    beforeEach(() => {
      mockWindowWidth(1024); // Desktop width
    });

    it('should show sidebar toggle button in header', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      // Desktop toggle button should be visible
      const toggleButton = screen.getByRole('button', { name: /collapse sidebar/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should toggle sidebar collapsed state when button is clicked', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      // Initially not collapsed
      expect(useUIStore.getState().sidebarCollapsed).toBe(false);

      // Click toggle button
      const toggleButton = screen.getByRole('button', { name: /collapse sidebar/i });
      fireEvent.click(toggleButton);

      // Should be collapsed now
      expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    });

    it('should update button label based on collapsed state', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      // Initially shows collapse label
      expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeInTheDocument();

      // Toggle to collapsed
      act(() => {
        useUIStore.getState().setSidebarCollapsed(true);
      });

      // Re-render to see updated label
      expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('should auto-collapse sidebar on mobile', async () => {
      // Start with desktop width
      mockWindowWidth(1024);
      
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      // Initially not collapsed on desktop
      expect(useUIStore.getState().sidebarCollapsed).toBe(false);

      // Resize to mobile
      await act(async () => {
        mockWindowWidth(600);
      });

      // Should be collapsed on mobile
      expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    });

    it('should show mobile menu button on small screens', async () => {
      // Start with mobile width
      mockWindowWidth(600);

      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      // Mobile toggle button should be visible
      const toggleButton = screen.getByRole('button', { name: /toggle sidebar/i });
      expect(toggleButton).toBeInTheDocument();
    });
  });

  describe('Theme Support', () => {
    it('should apply light theme classes', () => {
      useSettingsStore.getState().setTheme('light');

      const { container } = render(
        <Layout>
          <div>Main</div>
        </Layout>
      );

      expect(container.firstChild).toHaveAttribute('data-theme', 'light');
    });

    it('should apply dark theme classes', () => {
      useSettingsStore.getState().setTheme('dark');

      const { container } = render(
        <Layout>
          <div>Main</div>
        </Layout>
      );

      expect(container.firstChild).toHaveAttribute('data-theme', 'dark');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA roles', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
          footer={<span>Footer</span>}
        >
          <div>Main</div>
        </Layout>
      );

      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('complementary')).toBeInTheDocument();
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    });

    it('should have proper ARIA labels', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      expect(screen.getByRole('complementary')).toHaveAttribute('aria-label', 'Session list');
      expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Chat area');
    });

    it('should have aria-expanded on toggle button', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div>Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      const toggleButton = screen.getByRole('button', { name: /collapse sidebar/i });
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

      // Toggle to collapsed
      fireEvent.click(toggleButton);

      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    });

    it('should close mobile menu on Escape key', async () => {
      mockWindowWidth(600);

      const { container } = render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div data-testid="sidebar">Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      // Open mobile menu
      const toggleButton = screen.getByRole('button', { name: /toggle sidebar/i });
      fireEvent.click(toggleButton);

      // Verify menu is open (sidebar should be visible)
      const sidebarAside = screen.getByRole('complementary');
      expect(sidebarAside).toHaveClass('translate-x-0');

      // Press Escape on the layout container
      fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' });

      // Menu should be closed (sidebar should be translated off-screen)
      expect(sidebarAside).toHaveClass('-translate-x-full');
    });
  });

  describe('Sidebar Width', () => {
    it('should have correct width when expanded', () => {
      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div data-testid="sidebar">Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      const sidebar = screen.getByRole('complementary');
      // Check inline style for width
      expect(sidebar.style.width).toBe('280px');
    });

    it('should have zero width when collapsed', () => {
      useUIStore.getState().setSidebarCollapsed(true);

      render(
        <Layout
          header={<span>Header</span>}
          sidebar={<div data-testid="sidebar">Sidebar</div>}
        >
          <div>Main</div>
        </Layout>
      );

      const sidebar = screen.getByRole('complementary');
      // Check inline style for width
      expect(sidebar.style.width).toBe('0px');
    });
  });
});
