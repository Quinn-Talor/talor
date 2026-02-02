/**
 * Settings State Store
 * 设置状态 Store
 *
 * Manages settings state using Zustand, including theme, language,
 * default model, provider configurations, and MCP server configurations.
 * Includes persistence to localStorage for theme and language preferences.
 *
 * @requirements 6.1 - 提供 LLM 提供商配置界面
 * @requirements 6.2 - 允许用户选择默认模型
 * @requirements 6.3 - 提供 MCP 服务器管理界面
 * @requirements 6.6 - 提供主题切换功能
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderConfig, MCPServerConfig } from '../types/config';
import type { ConfigApi } from '../api/config';

/**
 * Theme type
 * 主题类型
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * Language type
 * 语言类型
 */
export type Language = 'en' | 'zh';

/**
 * Settings state interface
 * 设置状态接口
 */
export interface SettingsState {
  /** Current theme setting / 当前主题设置 */
  theme: Theme;
  /** Current language setting / 当前语言设置 */
  language: Language;
  /** Default model ID / 默认模型 ID */
  defaultModel: string | null;
  /** Provider configurations / 提供商配置列表 */
  providers: ProviderConfig[];
  /** MCP server configurations / MCP 服务器配置列表 */
  mcpServers: MCPServerConfig[];
}

/**
 * Settings actions interface
 * 设置操作接口
 */
export interface SettingsActions {
  /**
   * Sets the theme
   * 设置主题
   *
   * @param theme - The theme to set / 要设置的主题
   */
  setTheme(theme: Theme): void;

  /**
   * Sets the language
   * 设置语言
   *
   * @param language - The language to set / 要设置的语言
   */
  setLanguage(language: Language): void;

  /**
   * Sets the default model
   * 设置默认模型
   *
   * @param modelId - The model ID to set as default / 要设置为默认的模型 ID
   */
  setDefaultModel(modelId: string): void;

  /**
   * Updates a provider configuration
   * 更新提供商配置
   *
   * @param providerId - The provider ID to update / 要更新的提供商 ID
   * @param config - Partial configuration to merge / 要合并的部分配置
   */
  updateProvider(providerId: string, config: Partial<ProviderConfig>): void;

  /**
   * Adds a new provider configuration
   * 添加新的提供商配置
   *
   * @param config - The provider configuration to add / 要添加的提供商配置
   */
  addProvider(config: ProviderConfig): void;

  /**
   * Removes a provider configuration
   * 移除提供商配置
   *
   * @param providerId - The provider ID to remove / 要移除的提供商 ID
   */
  removeProvider(providerId: string): void;

  /**
   * Adds a new MCP server configuration
   * 添加新的 MCP 服务器配置
   *
   * @param config - The MCP server configuration to add / 要添加的 MCP 服务器配置
   */
  addMCPServer(config: MCPServerConfig): void;

  /**
   * Removes an MCP server configuration
   * 移除 MCP 服务器配置
   *
   * @param serverId - The server ID to remove / 要移除的服务器 ID
   */
  removeMCPServer(serverId: string): void;

  /**
   * Updates an MCP server configuration
   * 更新 MCP 服务器配置
   *
   * @param serverId - The server ID to update / 要更新的服务器 ID
   * @param config - Partial configuration to merge / 要合并的部分配置
   */
  updateMCPServer(serverId: string, config: Partial<MCPServerConfig>): void;

  /**
   * Loads settings from the backend
   * 从后端加载设置
   */
  loadSettings(): Promise<void>;

  /**
   * Saves settings to the backend
   * 保存设置到后端
   *
   * @param key - The configuration key to save / 要保存的配置键
   * @param value - The value to save / 要保存的值
   */
  saveSettings(key: string, value: unknown): Promise<void>;

  /**
   * Sets the config API instance
   * 设置配置 API 实例
   *
   * @param configApi - The config API instance / 配置 API 实例
   */
  setConfigApi(configApi: ConfigApi): void;

  /**
   * Resets settings to default values
   * 重置设置为默认值
   */
  resetSettings(): void;
}

/**
 * Combined settings store type
 * 组合的设置 store 类型
 */
export type SettingsStore = SettingsState & SettingsActions;

/**
 * Internal store state with API reference
 * 带有 API 引用的内部 store 状态
 */
interface InternalState {
  _configApi: ConfigApi | null;
}

/**
 * Initial state for the settings store
 * 设置 store 的初始状态
 */
const initialState: SettingsState = {
  theme: 'system',
  language: 'en',
  defaultModel: null,
  providers: [],
  mcpServers: [],
};

/**
 * Storage key for persisted settings
 * 持久化设置的存储键
 */
const STORAGE_KEY = 'talor-gui-settings';

/**
 * Creates the settings store with persistence
 * 创建带有持久化的设置 store
 *
 * Theme and language preferences are persisted to localStorage.
 * Provider and MCP server configurations are synced with the backend.
 */
export const useSettingsStore = create<SettingsStore & InternalState>()(
  persist(
    (set, get) => ({
      // Initial state
      ...initialState,

      // Internal API reference
      _configApi: null,

      /**
       * Sets the theme
       * 设置主题
       *
       * @requirements 6.6 - 提供主题切换功能
       */
      setTheme(theme: Theme): void {
        set({ theme });
        // Apply theme to document
        applyTheme(theme);
        // Sync with backend if API is available
        const { _configApi } = get();
        if (_configApi) {
          _configApi.set('theme', theme).catch(console.error);
        }
      },

      /**
       * Sets the language
       * 设置语言
       *
       * @requirements 10.2 - 允许用户切换界面语言
       * @requirements 10.4 - 记住用户的语言偏好设置
       */
      setLanguage(language: Language): void {
        set({ language });
        // Sync with backend if API is available
        const { _configApi } = get();
        if (_configApi) {
          _configApi.set('language', language).catch(console.error);
        }
      },

      /**
       * Sets the default model
       * 设置默认模型
       *
       * @requirements 6.2 - 允许用户选择默认模型
       */
      setDefaultModel(modelId: string): void {
        set({ defaultModel: modelId });
        // Sync with backend if API is available
        const { _configApi } = get();
        if (_configApi) {
          _configApi.set('defaultModel', modelId).catch(console.error);
        }
      },

      /**
       * Updates a provider configuration
       * 更新提供商配置
       *
       * @requirements 6.1 - 提供 LLM 提供商配置界面
       */
      updateProvider(providerId: string, config: Partial<ProviderConfig>): void {
        set((state) => {
          const updatedProviders = state.providers.map((provider) =>
            provider.id === providerId ? { ...provider, ...config } : provider
          );
          return { providers: updatedProviders };
        });
        // Sync with backend if API is available
        const { _configApi, providers } = get();
        if (_configApi) {
          _configApi.set('providers', providers).catch(console.error);
        }
      },

      /**
       * Adds a new provider configuration
       * 添加新的提供商配置
       *
       * @requirements 6.1 - 提供 LLM 提供商配置界面
       */
      addProvider(config: ProviderConfig): void {
        set((state) => {
          // Check if provider already exists
          const exists = state.providers.some((p) => p.id === config.id);
          if (exists) {
            return state;
          }
          return { providers: [...state.providers, config] };
        });
        // Sync with backend if API is available
        const { _configApi, providers } = get();
        if (_configApi) {
          _configApi.set('providers', providers).catch(console.error);
        }
      },

      /**
       * Removes a provider configuration
       * 移除提供商配置
       *
       * @requirements 6.1 - 提供 LLM 提供商配置界面
       */
      removeProvider(providerId: string): void {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== providerId),
        }));
        // Sync with backend if API is available
        const { _configApi, providers } = get();
        if (_configApi) {
          _configApi.set('providers', providers).catch(console.error);
        }
      },

      /**
       * Adds a new MCP server configuration
       * 添加新的 MCP 服务器配置
       *
       * @requirements 6.3 - 提供 MCP 服务器管理界面
       */
      addMCPServer(config: MCPServerConfig): void {
        set((state) => {
          // Check if server already exists
          const exists = state.mcpServers.some((s) => s.id === config.id);
          if (exists) {
            return state;
          }
          return { mcpServers: [...state.mcpServers, config] };
        });
        // Sync with backend if API is available
        const { _configApi, mcpServers } = get();
        if (_configApi) {
          _configApi.set('mcpServers', mcpServers).catch(console.error);
        }
      },

      /**
       * Removes an MCP server configuration
       * 移除 MCP 服务器配置
       *
       * @requirements 6.3 - 提供 MCP 服务器管理界面
       */
      removeMCPServer(serverId: string): void {
        set((state) => ({
          mcpServers: state.mcpServers.filter((s) => s.id !== serverId),
        }));
        // Sync with backend if API is available
        const { _configApi, mcpServers } = get();
        if (_configApi) {
          _configApi.set('mcpServers', mcpServers).catch(console.error);
        }
      },

      /**
       * Updates an MCP server configuration
       * 更新 MCP 服务器配置
       *
       * @requirements 6.3 - 提供 MCP 服务器管理界面
       */
      updateMCPServer(serverId: string, config: Partial<MCPServerConfig>): void {
        set((state) => {
          const updatedServers = state.mcpServers.map((server) =>
            server.id === serverId ? { ...server, ...config } : server
          );
          return { mcpServers: updatedServers };
        });
        // Sync with backend if API is available
        const { _configApi, mcpServers } = get();
        if (_configApi) {
          _configApi.set('mcpServers', mcpServers).catch(console.error);
        }
      },

      /**
       * Loads settings from the backend
       * 从后端加载设置
       */
      async loadSettings(): Promise<void> {
        const { _configApi } = get();
        if (!_configApi) {
          return;
        }

        try {
          const config = await _configApi.get();
          
          // Extract providers from config.providers object
          const providersArray: ProviderConfig[] = [];
          if (config.providers && typeof config.providers === 'object') {
            for (const [id, providerConfig] of Object.entries(config.providers)) {
              if (typeof providerConfig === 'object' && providerConfig !== null) {
                const pc = providerConfig as Record<string, unknown>;
                providersArray.push({
                  id,
                  name: (pc.name as string) ?? id,
                  apiKey: pc.apiKey as string | undefined,
                  baseUrl: pc.baseUrl as string | undefined,
                  defaultModel: pc.defaultModel as string | undefined,
                });
              }
            }
          }
          
          // Extract MCP servers from config.mcp object
          const mcpServersArray: MCPServerConfig[] = [];
          if (config.mcp && typeof config.mcp === 'object') {
            for (const [id, serverConfig] of Object.entries(config.mcp)) {
              if (typeof serverConfig === 'object' && serverConfig !== null) {
                const sc = serverConfig as Record<string, unknown>;
                mcpServersArray.push({
                  id,
                  name: (sc.name as string) ?? id,
                  command: (sc.command as string) ?? '',
                  args: (sc.args as string[]) ?? [],
                  env: (sc.env as Record<string, string>) ?? {},
                  transport: (sc.transport as 'stdio' | 'sse') ?? 'stdio',
                });
              }
            }
          }
          
          set({
            theme: (config.theme as Theme) ?? 'system',
            language: (config.language as Language) ?? 'en',
            defaultModel: config.defaultModel ?? null,
            providers: providersArray,
            mcpServers: mcpServersArray,
          });
          // Apply theme after loading
          applyTheme((config.theme as Theme) ?? 'system');
        } catch (error) {
          console.error('Failed to load settings:', error);
        }
      },

      /**
       * Saves settings to the backend
       * 保存设置到后端
       */
      async saveSettings(key: string, value: unknown): Promise<void> {
        const { _configApi } = get();
        if (!_configApi) {
          return;
        }

        try {
          await _configApi.set(key, value);
        } catch (error) {
          console.error('Failed to save settings:', error);
          throw error;
        }
      },

      /**
       * Sets the config API instance
       * 设置配置 API 实例
       */
      setConfigApi(configApi: ConfigApi): void {
        set({ _configApi: configApi });
      },

      /**
       * Resets settings to default values
       * 重置设置为默认值
       */
      resetSettings(): void {
        set(initialState);
        applyTheme('system');
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist theme and language to localStorage
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
      }),
      // Merge persisted state with initial state
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<SettingsState>),
      }),
    }
  )
);

/**
 * Applies the theme to the document
 * 将主题应用到文档
 *
 * @param theme - The theme to apply / 要应用的主题
 */
export function applyTheme(theme: Theme): void {
  // Only run in browser environment
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
}

/**
 * Gets the effective theme (resolves 'system' to actual theme)
 * 获取有效主题（将 'system' 解析为实际主题）
 *
 * @param theme - The theme setting / 主题设置
 * @returns The effective theme ('light' or 'dark') / 有效主题
 */
export function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    // Only check in browser environment
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return theme;
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default useSettingsStore;
