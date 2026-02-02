/**
 * Config API Module
 * 配置 API 模块
 *
 * Provides configuration management API calls for the Talor GUI client.
 * 为 Talor GUI 客户端提供配置管理 API 调用。
 *
 * @requirements 4.2 - 配置管理
 */

import type { TalorClient } from './client';

/**
 * Application configuration
 * 应用配置
 */
export interface AppConfig {
  /** Default agent name / 默认代理名称 */
  defaultAgent: string | null;
  /** Default model ID / 默认模型 ID */
  defaultModel: string | null;
  /** Provider configurations / 提供者配置 */
  providers: Record<string, unknown>;
  /** MCP configurations / MCP 配置 */
  mcp: Record<string, unknown>;
  /** Theme setting / 主题设置 */
  theme?: string;
  /** Language setting / 语言设置 */
  language?: string;
  /** MCP servers configuration / MCP 服务器配置 */
  mcpServers?: Record<string, unknown>[];
}

/**
 * Config scope for setting values
 * 设置值的配置范围
 */
export type ConfigScope = 'global' | 'project';

/**
 * Config API interface
 * 配置 API 接口
 */
export interface ConfigApi {
  /**
   * Gets the current configuration
   * 获取当前配置
   *
   * @returns Application configuration / 应用配置
   */
  get(): Promise<AppConfig>;

  /**
   * Sets a configuration value
   * 设置配置值
   *
   * @param key - Configuration key / 配置键
   * @param value - Configuration value / 配置值
   * @param scope - Configuration scope (global or project) / 配置范围
   */
  set(key: string, value: unknown, scope?: ConfigScope): Promise<void>;
}

/**
 * Backend config response
 * 后端配置响应
 */
interface BackendConfigResponse {
  default_agent: string | null;
  default_model: string | null;
  providers: Record<string, unknown>;
  mcp: Record<string, unknown>;
}

/**
 * Converts backend config response to frontend AppConfig
 * 将后端配置响应转换为前端 AppConfig
 */
function toAppConfig(response: BackendConfigResponse): AppConfig {
  return {
    defaultAgent: response.default_agent,
    defaultModel: response.default_model,
    providers: response.providers,
    mcp: response.mcp,
  };
}

/**
 * Creates a config API instance bound to a TalorClient
 * 创建绑定到 TalorClient 的配置 API 实例
 *
 * @param client - The TalorClient instance / TalorClient 实例
 * @returns Config API object / 配置 API 对象
 */
export function createConfigApi(client: TalorClient): ConfigApi {
  return {
    /**
     * Gets the current configuration
     * 获取当前配置
     *
     * GET /api/config
     *
     * @returns Application configuration / 应用配置
     */
    async get(): Promise<AppConfig> {
      const response = await client.get<BackendConfigResponse>('/api/config');
      return toAppConfig(response);
    },

    /**
     * Sets a configuration value
     * 设置配置值
     *
     * PUT /api/config/:key
     *
     * @param key - Configuration key / 配置键
     * @param value - Configuration value / 配置值
     * @param scope - Configuration scope (global or project) / 配置范围
     */
    async set(key: string, value: unknown, scope: ConfigScope = 'project'): Promise<void> {
      await client.put<void>(
        `/api/config/${encodeURIComponent(key)}?scope=${encodeURIComponent(scope)}`,
        value
      );
    },
  };
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default createConfigApi;
