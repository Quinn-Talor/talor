/**
 * Router Configuration Tests
 * 路由配置测试
 *
 * Tests for the React Router configuration including:
 * - Route definitions
 * - Navigation between pages
 * - Route parameter handling
 * - 404 handling
 *
 * @requirements 2.2 - 用户选择一个现有会话时，加载该会话的消息历史
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routeConfig, ROUTES, getSessionPath } from './index';

// Mock the i18next translation
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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

// Mock the stores
vi.mock('../store/ui', () => ({
  useUIStore: () => ({
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  }),
}));

vi.mock('../store/settings', () => ({
  useSettingsStore: () => ({
    theme: 'light',
  }),
  getEffectiveTheme: () => 'light',
}));

// Mock the session store
vi.mock('../store/session', () => ({
  useSessionStore: () => ({
    sessions: [],
    currentSessionId: null,
    messages: {},
    isLoading: false,
    error: null,
    fetchSessions: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({ id: 'new-session', title: 'New Session', createdAt: Date.now(), updatedAt: Date.now(), metadata: {} }),
    selectSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    clearError: vi.fn(),
    setApis: vi.fn(),
  }),
}));

// Mock scrollIntoView for jsdom
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * Helper function to render routes with memory router
 * 使用内存路由渲染路由的辅助函数
 *
 * @param initialEntries - Initial route entries / 初始路由条目
 * @returns Rendered component / 渲染的组件
 */
function renderWithRouter(initialEntries: string[] = ['/']) {
  const router = createMemoryRouter(routeConfig, {
    initialEntries,
  });

  return render(<RouterProvider router={router} />);
}

describe('Router Configuration', () => {
  describe('ROUTES constants', () => {
    it('should define HOME route as "/"', () => {
      expect(ROUTES.HOME).toBe('/');
    });

    it('should define SESSION route with sessionId parameter', () => {
      expect(ROUTES.SESSION).toBe('/session/:sessionId');
    });

    it('should define SETTINGS route as "/settings"', () => {
      expect(ROUTES.SETTINGS).toBe('/settings');
    });
  });

  describe('getSessionPath helper', () => {
    it('should generate correct session path for given sessionId', () => {
      expect(getSessionPath('abc123')).toBe('/session/abc123');
    });

    it('should handle session IDs with special characters', () => {
      expect(getSessionPath('session-with-dashes')).toBe('/session/session-with-dashes');
    });

    it('should handle UUID-style session IDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(getSessionPath(uuid)).toBe(`/session/${uuid}`);
    });
  });

  describe('Route rendering', () => {
    it('should render home page at "/" route', async () => {
      renderWithRouter(['/']);

      await waitFor(() => {
        // HomePage renders with home-page testid
        expect(screen.getByTestId('home-page')).toBeInTheDocument();
      });
    });

    it('should render session page at "/session/:sessionId" route', async () => {
      renderWithRouter(['/session/test-session-123']);

      await waitFor(() => {
        // Session route also uses HomePage component
        expect(screen.getByTestId('home-page')).toBeInTheDocument();
      });
    });

    it('should render settings page at "/settings" route', async () => {
      renderWithRouter(['/settings']);

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument();
      });
    });

    it('should render 404 page for unknown routes', async () => {
      renderWithRouter(['/unknown-route']);

      await waitFor(() => {
        expect(screen.getByText('404')).toBeInTheDocument();
        expect(screen.getByText('Page not found')).toBeInTheDocument();
      });
    });

    it('should render 404 page with link to home', async () => {
      renderWithRouter(['/non-existent-page']);

      await waitFor(() => {
        const homeLink = screen.getByRole('link', { name: /go home/i });
        expect(homeLink).toBeInTheDocument();
        expect(homeLink).toHaveAttribute('href', '/');
      });
    });
  });

  describe('Layout integration', () => {
    it('should wrap routes with Layout component', async () => {
      renderWithRouter(['/']);

      await waitFor(() => {
        // Layout should render with main role
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });

    it('should render Layout for session routes', async () => {
      renderWithRouter(['/session/abc']);

      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });

    it('should render Layout for settings routes', async () => {
      renderWithRouter(['/settings']);

      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });
  });

  describe('Session route parameters', () => {
    it('should handle various session ID formats', async () => {
      const sessionIds = [
        'simple',
        'with-dashes',
        'with_underscores',
        '12345',
        'abc123def456',
      ];

      for (const sessionId of sessionIds) {
        const { unmount } = renderWithRouter([`/session/${sessionId}`]);

        await waitFor(() => {
          // Session route uses HomePage component
          expect(screen.getByTestId('home-page')).toBeInTheDocument();
        });

        unmount();
      }
    });
  });
});

describe('Route structure', () => {
  it('should have correct number of child routes', () => {
    const rootRoute = routeConfig[0];
    expect(rootRoute.children).toHaveLength(4); // home, session, settings, 404
  });

  it('should have index route for home page', () => {
    const rootRoute = routeConfig[0];
    const indexRoute = rootRoute.children?.find((r) => 'index' in r && r.index);
    expect(indexRoute).toBeDefined();
  });

  it('should have session route with parameter', () => {
    const rootRoute = routeConfig[0];
    const sessionRoute = rootRoute.children?.find(
      (r) => 'path' in r && r.path === 'session/:sessionId'
    );
    expect(sessionRoute).toBeDefined();
  });

  it('should have settings route', () => {
    const rootRoute = routeConfig[0];
    const settingsRoute = rootRoute.children?.find(
      (r) => 'path' in r && r.path === 'settings'
    );
    expect(settingsRoute).toBeDefined();
  });

  it('should have catch-all route for 404', () => {
    const rootRoute = routeConfig[0];
    const notFoundRoute = rootRoute.children?.find(
      (r) => 'path' in r && r.path === '*'
    );
    expect(notFoundRoute).toBeDefined();
  });
});
