/**
 * App Component Tests
 * 应用入口组件测试
 *
 * Tests for the main App component including:
 * - Provider integration (Theme, i18n)
 * - Router integration
 * - API client initialization
 * - Event subscription setup
 *
 * @requirements 1.1 - HTTP 连接到 Talor_Backend 的 REST API
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { useSessionStore } from './store/session';
import { useUIStore } from './store/ui';

// Mock the router to avoid full routing setup in tests
vi.mock('./router', () => ({
  AppRouter: function AppRouter() {
    return <div data-testid="app-router">Router Content</div>;
  },
}));

// Store mock functions for events API - must be defined before vi.mock
const mockEventsFns = {
  unsubscribe: vi.fn(),
  disconnect: vi.fn(),
  onConnectionStateChange: vi.fn(),
  subscribe: vi.fn(),
};

// Mock the API modules
vi.mock('./api/client', () => {
  // Create a mock class
  const MockTalorClient = vi.fn().mockImplementation(function(this: Record<string, unknown>) {
    this.getBaseUrl = () => 'http://localhost:8000';
    this.getAuthToken = () => null;
    this.setAuthToken = vi.fn();
    return this;
  });
  return { TalorClient: MockTalorClient };
});

vi.mock('./api/session', () => ({
  createSessionApi: vi.fn().mockReturnValue({
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    getMessages: vi.fn(),
  }),
}));

vi.mock('./api/agent', () => ({
  createAgentApi: vi.fn().mockReturnValue({
    processPrompt: vi.fn(),
  }),
}));

vi.mock('./api/config', () => ({
  createConfigApi: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    listModels: vi.fn(),
    listMCPServers: vi.fn(),
    listTools: vi.fn(),
  }),
}));

vi.mock('./api/events', () => ({
  createEventsApi: vi.fn().mockImplementation(() => {
    // Reset and setup subscribe to return unsubscribe
    mockEventsFns.subscribe.mockReturnValue(mockEventsFns.unsubscribe);
    return {
      subscribe: mockEventsFns.subscribe,
      onConnectionStateChange: mockEventsFns.onConnectionStateChange,
      disconnect: mockEventsFns.disconnect,
      getConnectionState: () => 'disconnected',
      getRetryCount: () => 0,
      reconnect: vi.fn(),
    };
  }),
}));

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
  I18nextProvider: function I18nextProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  },
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  withTranslation: () => <T extends React.ComponentType<unknown>>(Component: T) => {
    // Return a wrapper component that passes t function as prop
    const WrappedComponent = (props: Record<string, unknown>) => {
      const mockT = (key: string) => key;
      return React.createElement(Component, { ...props, t: mockT, i18n: { language: 'en' }, tReady: true });
    };
    WrappedComponent.displayName = `withTranslation(${Component.displayName || Component.name || 'Component'})`;
    return WrappedComponent;
  },
}));

// Mock the settings store for ThemeProvider
vi.mock('./store/settings', () => ({
  useSettingsStore: vi.fn(() => ({
    theme: 'light',
    setTheme: vi.fn(),
    language: 'en',
    setLanguage: vi.fn(),
  })),
  getEffectiveTheme: () => 'light',
  applyTheme: vi.fn(),
}));

describe('App Component', () => {
  // Mock matchMedia for ThemeProvider
  const mockMatchMedia = vi.fn();

  beforeEach(() => {
    // Reset stores
    useSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: {},
      isLoading: false,
      error: null,
      _sessionApi: null,
      _agentApi: null,
    });

    useUIStore.setState({
      sidebarCollapsed: false,
      loadingStates: {
        sessions: false,
        messages: false,
        settings: false,
        models: false,
        tools: false,
        global: false,
      },
      currentPermissionRequest: null,
      permissionDialogVisible: false,
      settingsPanelOpen: false,
      notification: null,
      connectionState: 'disconnected',
      connectionRetryCount: 0,
    });

    // Mock matchMedia
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    window.matchMedia = mockMatchMedia;

    // Clear all mocks
    vi.clearAllMocks();
    
    // Reset event mock functions
    mockEventsFns.subscribe.mockClear();
    mockEventsFns.unsubscribe.mockClear();
    mockEventsFns.disconnect.mockClear();
    mockEventsFns.onConnectionStateChange.mockClear();
    mockEventsFns.subscribe.mockReturnValue(mockEventsFns.unsubscribe);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render the App component', () => {
      render(<App />);
      expect(screen.getByTestId('app-router')).toBeInTheDocument();
    });

    it('should render router content', () => {
      render(<App />);
      expect(screen.getByText('Router Content')).toBeInTheDocument();
    });
  });

  describe('provider integration', () => {
    it('should wrap content with ThemeProvider', () => {
      // ThemeProvider is tested by checking that the router renders
      // (it would fail if ThemeProvider wasn't working)
      render(<App />);
      expect(screen.getByTestId('app-router')).toBeInTheDocument();
    });

    it('should wrap content with I18nextProvider', () => {
      // I18nextProvider is tested by checking that the router renders
      render(<App />);
      expect(screen.getByTestId('app-router')).toBeInTheDocument();
    });
  });

  describe('API initialization', () => {
    it('should initialize API client with default base URL', async () => {
      const { TalorClient } = await import('./api/client');
      render(<App />);

      expect(TalorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: expect.any(String),
          timeout: 30000,
        })
      );
    });

    it('should initialize API client with custom base URL', async () => {
      const { TalorClient } = await import('./api/client');
      render(<App apiBaseUrl="http://custom-api:9000" />);

      expect(TalorClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://custom-api:9000',
        })
      );
    });

    it('should create session API', async () => {
      const { createSessionApi } = await import('./api/session');
      render(<App />);

      expect(createSessionApi).toHaveBeenCalled();
    });

    it('should create agent API', async () => {
      const { createAgentApi } = await import('./api/agent');
      render(<App />);

      expect(createAgentApi).toHaveBeenCalled();
    });

    it('should create config API', async () => {
      const { createConfigApi } = await import('./api/config');
      render(<App />);

      expect(createConfigApi).toHaveBeenCalled();
    });

    it('should create events API', async () => {
      const { createEventsApi } = await import('./api/events');
      render(<App />);

      expect(createEventsApi).toHaveBeenCalled();
    });
  });

  describe('store integration', () => {
    it('should set APIs in session store', async () => {
      render(<App />);

      await waitFor(() => {
        const state = useSessionStore.getState();
        expect(state._sessionApi).not.toBeNull();
        expect(state._agentApi).not.toBeNull();
      });
    });
  });

  describe('event subscription', () => {
    it('should subscribe to events on mount', () => {
      render(<App />);

      expect(mockEventsFns.subscribe).toHaveBeenCalled();
    });

    it('should set up connection state handler', () => {
      render(<App />);

      expect(mockEventsFns.onConnectionStateChange).toHaveBeenCalled();
    });

    it('should unsubscribe from events on unmount', () => {
      const { unmount } = render(<App />);

      unmount();

      expect(mockEventsFns.unsubscribe).toHaveBeenCalled();
    });

    it('should disconnect events on unmount', () => {
      const { unmount } = render(<App />);

      unmount();

      expect(mockEventsFns.disconnect).toHaveBeenCalled();
    });
  });

  describe('connection state', () => {
    it('should update UI store when connection state changes', async () => {
      render(<App />);

      // Get the handler that was passed to onConnectionStateChange
      const handler = mockEventsFns.onConnectionStateChange.mock.calls[0][0];

      // Simulate connection state change
      handler('connected', 0);

      await waitFor(() => {
        const state = useUIStore.getState();
        expect(state.connectionState).toBe('connected');
      });
    });

    it('should update retry count when connection state changes', async () => {
      render(<App />);

      // Get the handler that was passed to onConnectionStateChange
      const handler = mockEventsFns.onConnectionStateChange.mock.calls[0][0];

      // Simulate reconnecting state with retry count
      handler('reconnecting', 3);

      await waitFor(() => {
        const state = useUIStore.getState();
        expect(state.connectionState).toBe('reconnecting');
        expect(state.connectionRetryCount).toBe(3);
      });
    });
  });
});

describe('App with different configurations', () => {
  beforeEach(() => {
    // Reset stores
    useSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: {},
      isLoading: false,
      error: null,
      _sessionApi: null,
      _agentApi: null,
    });

    useUIStore.setState({
      sidebarCollapsed: false,
      loadingStates: {
        sessions: false,
        messages: false,
        settings: false,
        models: false,
        tools: false,
        global: false,
      },
      currentPermissionRequest: null,
      permissionDialogVisible: false,
      settingsPanelOpen: false,
      notification: null,
      connectionState: 'disconnected',
      connectionRetryCount: 0,
    });

    // Mock matchMedia
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    vi.clearAllMocks();
    
    // Reset event mock functions
    mockEventsFns.subscribe.mockClear();
    mockEventsFns.unsubscribe.mockClear();
    mockEventsFns.disconnect.mockClear();
    mockEventsFns.onConnectionStateChange.mockClear();
    mockEventsFns.subscribe.mockReturnValue(mockEventsFns.unsubscribe);
  });

  it('should accept custom API base URL prop', () => {
    render(<App apiBaseUrl="http://localhost:3000" />);
    expect(screen.getByTestId('app-router')).toBeInTheDocument();
  });

  it('should render without props using defaults', () => {
    render(<App />);
    expect(screen.getByTestId('app-router')).toBeInTheDocument();
  });
});
