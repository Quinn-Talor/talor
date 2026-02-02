/**
 * Settings Store Tests
 * 设置 Store 测试
 *
 * Unit tests for the settings store implementation.
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 * @requirements 6.2 - 允许用户选择默认模型
 * @requirements 6.3 - 提供 MCP 服务器管理界面
 * @requirements 6.6 - 提供主题切换功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  useSettingsStore,
  applyTheme,
  getEffectiveTheme,
  type Theme,
  type Language,
} from './settings';
import type { ProviderConfig, MCPServerConfig, Config } from '../types/config';
import type { ConfigApi } from '../api/config';

/**
 * Creates a mock ConfigApi
 * 创建模拟的 ConfigApi
 */
function createMockConfigApi(overrides: Partial<ConfigApi> = {}): ConfigApi {
  return {
    get: vi.fn(),
    set: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates a mock ProviderConfig
 * 创建模拟的提供商配置
 */
function createMockProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    apiKey: 'test-api-key',
    baseUrl: 'https://api.test.com',
    defaultModel: 'test-model',
    ...overrides,
  };
}

/**
 * Creates a mock MCPServerConfig
 * 创建模拟的 MCP 服务器配置
 */
function createMockMCPServerConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    id: 'server-1',
    name: 'Test Server',
    command: 'test-command',
    args: ['--arg1', '--arg2'],
    env: { TEST_VAR: 'value' },
    transport: 'stdio',
    ...overrides,
  };
}

describe('Settings Store', () => {
  // Store original localStorage
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    // Mock localStorage
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

    // Reset the store before each test
    useSettingsStore.setState({
      theme: 'system',
      language: 'en',
      defaultModel: null,
      providers: [],
      mcpServers: [],
      _configApi: null,
    });
  });

  afterEach(() => {
    // Restore original localStorage
    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useSettingsStore.getState();

      expect(state.theme).toBe('system');
      expect(state.language).toBe('en');
      expect(state.defaultModel).toBeNull();
      expect(state.providers).toEqual([]);
      expect(state.mcpServers).toEqual([]);
    });
  });

  describe('setTheme', () => {
    it('should set theme to light', () => {
      useSettingsStore.getState().setTheme('light');

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('light');
    });

    it('should set theme to dark', () => {
      useSettingsStore.getState().setTheme('dark');

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('dark');
    });

    it('should set theme to system', () => {
      useSettingsStore.setState({ theme: 'light' });
      useSettingsStore.getState().setTheme('system');

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('system');
    });

    it('should sync theme with backend when API is available', async () => {
      const configApi = createMockConfigApi({
        set: vi.fn().mockResolvedValue(undefined),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      useSettingsStore.getState().setTheme('dark');

      // Wait for async operation
      await vi.waitFor(() => {
        expect(configApi.set).toHaveBeenCalledWith('theme', 'dark');
      });
    });
  });

  describe('setLanguage', () => {
    it('should set language to en', () => {
      useSettingsStore.setState({ language: 'zh' });
      useSettingsStore.getState().setLanguage('en');

      const state = useSettingsStore.getState();
      expect(state.language).toBe('en');
    });

    it('should set language to zh', () => {
      useSettingsStore.getState().setLanguage('zh');

      const state = useSettingsStore.getState();
      expect(state.language).toBe('zh');
    });

    it('should sync language with backend when API is available', async () => {
      const configApi = createMockConfigApi({
        set: vi.fn().mockResolvedValue(undefined),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      useSettingsStore.getState().setLanguage('zh');

      await vi.waitFor(() => {
        expect(configApi.set).toHaveBeenCalledWith('language', 'zh');
      });
    });
  });

  describe('setDefaultModel', () => {
    it('should set default model', () => {
      useSettingsStore.getState().setDefaultModel('gpt-4');

      const state = useSettingsStore.getState();
      expect(state.defaultModel).toBe('gpt-4');
    });

    it('should sync default model with backend when API is available', async () => {
      const configApi = createMockConfigApi({
        set: vi.fn().mockResolvedValue(undefined),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      useSettingsStore.getState().setDefaultModel('claude-3');

      await vi.waitFor(() => {
        expect(configApi.set).toHaveBeenCalledWith('defaultModel', 'claude-3');
      });
    });
  });

  describe('Provider Management', () => {
    describe('addProvider', () => {
      it('should add a new provider', () => {
        const provider = createMockProviderConfig({ id: 'openai' });

        useSettingsStore.getState().addProvider(provider);

        const state = useSettingsStore.getState();
        expect(state.providers).toHaveLength(1);
        expect(state.providers[0].id).toBe('openai');
      });

      it('should not add duplicate provider', () => {
        const provider = createMockProviderConfig({ id: 'openai' });
        useSettingsStore.setState({ providers: [provider] });

        useSettingsStore.getState().addProvider(provider);

        const state = useSettingsStore.getState();
        expect(state.providers).toHaveLength(1);
      });

      it('should sync providers with backend when API is available', async () => {
        const configApi = createMockConfigApi({
          set: vi.fn().mockResolvedValue(undefined),
        });
        const provider = createMockProviderConfig({ id: 'openai' });

        useSettingsStore.getState().setConfigApi(configApi);
        useSettingsStore.getState().addProvider(provider);

        await vi.waitFor(() => {
          expect(configApi.set).toHaveBeenCalledWith('providers', [provider]);
        });
      });
    });

    describe('updateProvider', () => {
      it('should update existing provider', () => {
        const provider = createMockProviderConfig({ id: 'openai', apiKey: 'old-key' });
        useSettingsStore.setState({ providers: [provider] });

        useSettingsStore.getState().updateProvider('openai', { apiKey: 'new-key' });

        const state = useSettingsStore.getState();
        expect(state.providers[0].apiKey).toBe('new-key');
      });

      it('should not modify other providers', () => {
        const provider1 = createMockProviderConfig({ id: 'openai', apiKey: 'key1' });
        const provider2 = createMockProviderConfig({ id: 'anthropic', apiKey: 'key2' });
        useSettingsStore.setState({ providers: [provider1, provider2] });

        useSettingsStore.getState().updateProvider('openai', { apiKey: 'new-key' });

        const state = useSettingsStore.getState();
        expect(state.providers[0].apiKey).toBe('new-key');
        expect(state.providers[1].apiKey).toBe('key2');
      });

      it('should preserve other fields when updating', () => {
        const provider = createMockProviderConfig({
          id: 'openai',
          name: 'OpenAI',
          apiKey: 'old-key',
          baseUrl: 'https://api.openai.com',
        });
        useSettingsStore.setState({ providers: [provider] });

        useSettingsStore.getState().updateProvider('openai', { apiKey: 'new-key' });

        const state = useSettingsStore.getState();
        expect(state.providers[0].name).toBe('OpenAI');
        expect(state.providers[0].baseUrl).toBe('https://api.openai.com');
      });
    });

    describe('removeProvider', () => {
      it('should remove provider by id', () => {
        const provider1 = createMockProviderConfig({ id: 'openai' });
        const provider2 = createMockProviderConfig({ id: 'anthropic' });
        useSettingsStore.setState({ providers: [provider1, provider2] });

        useSettingsStore.getState().removeProvider('openai');

        const state = useSettingsStore.getState();
        expect(state.providers).toHaveLength(1);
        expect(state.providers[0].id).toBe('anthropic');
      });

      it('should handle removing non-existent provider', () => {
        const provider = createMockProviderConfig({ id: 'openai' });
        useSettingsStore.setState({ providers: [provider] });

        useSettingsStore.getState().removeProvider('non-existent');

        const state = useSettingsStore.getState();
        expect(state.providers).toHaveLength(1);
      });
    });
  });

  describe('MCP Server Management', () => {
    describe('addMCPServer', () => {
      it('should add a new MCP server', () => {
        const server = createMockMCPServerConfig({ id: 'server-1' });

        useSettingsStore.getState().addMCPServer(server);

        const state = useSettingsStore.getState();
        expect(state.mcpServers).toHaveLength(1);
        expect(state.mcpServers[0].id).toBe('server-1');
      });

      it('should not add duplicate MCP server', () => {
        const server = createMockMCPServerConfig({ id: 'server-1' });
        useSettingsStore.setState({ mcpServers: [server] });

        useSettingsStore.getState().addMCPServer(server);

        const state = useSettingsStore.getState();
        expect(state.mcpServers).toHaveLength(1);
      });

      it('should sync MCP servers with backend when API is available', async () => {
        const configApi = createMockConfigApi({
          set: vi.fn().mockResolvedValue(undefined),
        });
        const server = createMockMCPServerConfig({ id: 'server-1' });

        useSettingsStore.getState().setConfigApi(configApi);
        useSettingsStore.getState().addMCPServer(server);

        await vi.waitFor(() => {
          expect(configApi.set).toHaveBeenCalledWith('mcpServers', [server]);
        });
      });
    });

    describe('updateMCPServer', () => {
      it('should update existing MCP server', () => {
        const server = createMockMCPServerConfig({ id: 'server-1', name: 'Old Name' });
        useSettingsStore.setState({ mcpServers: [server] });

        useSettingsStore.getState().updateMCPServer('server-1', { name: 'New Name' });

        const state = useSettingsStore.getState();
        expect(state.mcpServers[0].name).toBe('New Name');
      });

      it('should not modify other servers', () => {
        const server1 = createMockMCPServerConfig({ id: 'server-1', name: 'Server 1' });
        const server2 = createMockMCPServerConfig({ id: 'server-2', name: 'Server 2' });
        useSettingsStore.setState({ mcpServers: [server1, server2] });

        useSettingsStore.getState().updateMCPServer('server-1', { name: 'Updated' });

        const state = useSettingsStore.getState();
        expect(state.mcpServers[0].name).toBe('Updated');
        expect(state.mcpServers[1].name).toBe('Server 2');
      });

      it('should preserve other fields when updating', () => {
        const server = createMockMCPServerConfig({
          id: 'server-1',
          name: 'Test Server',
          command: 'test-cmd',
          args: ['--arg'],
        });
        useSettingsStore.setState({ mcpServers: [server] });

        useSettingsStore.getState().updateMCPServer('server-1', { name: 'New Name' });

        const state = useSettingsStore.getState();
        expect(state.mcpServers[0].command).toBe('test-cmd');
        expect(state.mcpServers[0].args).toEqual(['--arg']);
      });
    });

    describe('removeMCPServer', () => {
      it('should remove MCP server by id', () => {
        const server1 = createMockMCPServerConfig({ id: 'server-1' });
        const server2 = createMockMCPServerConfig({ id: 'server-2' });
        useSettingsStore.setState({ mcpServers: [server1, server2] });

        useSettingsStore.getState().removeMCPServer('server-1');

        const state = useSettingsStore.getState();
        expect(state.mcpServers).toHaveLength(1);
        expect(state.mcpServers[0].id).toBe('server-2');
      });

      it('should handle removing non-existent server', () => {
        const server = createMockMCPServerConfig({ id: 'server-1' });
        useSettingsStore.setState({ mcpServers: [server] });

        useSettingsStore.getState().removeMCPServer('non-existent');

        const state = useSettingsStore.getState();
        expect(state.mcpServers).toHaveLength(1);
      });
    });
  });

  describe('loadSettings', () => {
    it('should load settings from backend', async () => {
      const config: Config = {
        theme: 'dark',
        language: 'zh',
        defaultModel: 'gpt-4',
        providers: [createMockProviderConfig({ id: 'openai' })],
        mcpServers: [createMockMCPServerConfig({ id: 'server-1' })],
      };

      const configApi = createMockConfigApi({
        get: vi.fn().mockResolvedValue(config),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      await useSettingsStore.getState().loadSettings();

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('dark');
      expect(state.language).toBe('zh');
      expect(state.defaultModel).toBe('gpt-4');
      expect(state.providers).toHaveLength(1);
      expect(state.mcpServers).toHaveLength(1);
    });

    it('should use default values for missing config fields', async () => {
      const config: Config = {};

      const configApi = createMockConfigApi({
        get: vi.fn().mockResolvedValue(config),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      await useSettingsStore.getState().loadSettings();

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('system');
      expect(state.language).toBe('en');
      expect(state.defaultModel).toBeNull();
      expect(state.providers).toEqual([]);
      expect(state.mcpServers).toEqual([]);
    });

    it('should not throw when API is not initialized', async () => {
      await expect(useSettingsStore.getState().loadSettings()).resolves.not.toThrow();
    });

    it('should handle API errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const configApi = createMockConfigApi({
        get: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      await useSettingsStore.getState().loadSettings();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load settings:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('saveSettings', () => {
    it('should save settings to backend', async () => {
      const configApi = createMockConfigApi({
        set: vi.fn().mockResolvedValue(undefined),
      });

      useSettingsStore.getState().setConfigApi(configApi);
      await useSettingsStore.getState().saveSettings('theme', 'dark');

      expect(configApi.set).toHaveBeenCalledWith('theme', 'dark');
    });

    it('should not throw when API is not initialized', async () => {
      await expect(useSettingsStore.getState().saveSettings('theme', 'dark')).resolves.not.toThrow();
    });

    it('should throw on API error', async () => {
      const configApi = createMockConfigApi({
        set: vi.fn().mockRejectedValue(new Error('Save failed')),
      });

      useSettingsStore.getState().setConfigApi(configApi);

      await expect(useSettingsStore.getState().saveSettings('theme', 'dark')).rejects.toThrow(
        'Save failed'
      );
    });
  });

  describe('setConfigApi', () => {
    it('should set the config API instance', () => {
      const configApi = createMockConfigApi();

      useSettingsStore.getState().setConfigApi(configApi);

      const state = useSettingsStore.getState();
      expect(state._configApi).toBe(configApi);
    });
  });

  describe('resetSettings', () => {
    it('should reset all settings to default values', () => {
      useSettingsStore.setState({
        theme: 'dark',
        language: 'zh',
        defaultModel: 'gpt-4',
        providers: [createMockProviderConfig()],
        mcpServers: [createMockMCPServerConfig()],
      });

      useSettingsStore.getState().resetSettings();

      const state = useSettingsStore.getState();
      expect(state.theme).toBe('system');
      expect(state.language).toBe('en');
      expect(state.defaultModel).toBeNull();
      expect(state.providers).toEqual([]);
      expect(state.mcpServers).toEqual([]);
    });
  });
});

describe('Theme Utilities', () => {
  describe('applyTheme', () => {
    let originalDocument: typeof document;

    beforeEach(() => {
      // Save original document
      originalDocument = global.document;

      // Mock document
      const mockClassList = {
        add: vi.fn(),
        remove: vi.fn(),
      };
      global.document = {
        documentElement: {
          classList: mockClassList,
        },
      } as unknown as Document;

      // Mock window.matchMedia
      Object.defineProperty(global, 'window', {
        value: {
          matchMedia: vi.fn().mockReturnValue({
            matches: false,
          }),
        },
        writable: true,
      });
    });

    afterEach(() => {
      global.document = originalDocument;
    });

    it('should add dark class for dark theme', () => {
      applyTheme('dark');

      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('light');
    });

    it('should add light class for light theme', () => {
      applyTheme('light');

      expect(document.documentElement.classList.add).toHaveBeenCalledWith('light');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should use system preference for system theme', () => {
      // Mock system preference as dark
      Object.defineProperty(global, 'window', {
        value: {
          matchMedia: vi.fn().mockReturnValue({
            matches: true, // prefers dark
          }),
        },
        writable: true,
      });

      applyTheme('system');

      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });
  });

  describe('getEffectiveTheme', () => {
    beforeEach(() => {
      // Mock window.matchMedia
      Object.defineProperty(global, 'window', {
        value: {
          matchMedia: vi.fn().mockReturnValue({
            matches: false,
          }),
        },
        writable: true,
      });
    });

    it('should return light for light theme', () => {
      expect(getEffectiveTheme('light')).toBe('light');
    });

    it('should return dark for dark theme', () => {
      expect(getEffectiveTheme('dark')).toBe('dark');
    });

    it('should return light for system theme when system prefers light', () => {
      Object.defineProperty(global, 'window', {
        value: {
          matchMedia: vi.fn().mockReturnValue({
            matches: false, // prefers light
          }),
        },
        writable: true,
      });

      expect(getEffectiveTheme('system')).toBe('light');
    });

    it('should return dark for system theme when system prefers dark', () => {
      Object.defineProperty(global, 'window', {
        value: {
          matchMedia: vi.fn().mockReturnValue({
            matches: true, // prefers dark
          }),
        },
        writable: true,
      });

      expect(getEffectiveTheme('system')).toBe('dark');
    });
  });
});
