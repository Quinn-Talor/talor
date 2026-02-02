/**
 * Provider API Module
 * 提供者 API 模块
 *
 * Provides provider and model management API calls for the Talor GUI client.
 * 为 Talor GUI 客户端提供提供者和模型管理 API 调用。
 *
 * @requirements 4.1 - 模型选择
 */

import type { TalorClient } from './client';

/**
 * Model information
 * 模型信息
 */
export interface ModelInfo {
  /** Model ID (e.g., "gpt-4") / 模型 ID */
  id: string;
  /** Model display name / 模型显示名称 */
  name: string;
  /** Context window length / 上下文窗口长度 */
  contextLength: number;
  /** Maximum output tokens / 最大输出令牌数 */
  maxOutputTokens: number;
}

/**
 * Provider information
 * 提供者信息
 */
export interface ProviderInfo {
  /** Provider ID (e.g., "openai") / 提供者 ID */
  id: string;
  /** Provider display name / 提供者显示名称 */
  name: string;
  /** Available models / 可用模型 */
  models: ModelInfo[];
}

/**
 * Full model info with provider
 * 包含提供者的完整模型信息
 */
export interface FullModelInfo {
  /** Full model ID (e.g., "openai/gpt-4") / 完整模型 ID */
  id: string;
  /** Model display name / 模型显示名称 */
  name: string;
  /** Provider ID / 提供者 ID */
  provider: string;
  /** Context window length / 上下文窗口长度 */
  contextLength: number;
  /** Maximum output tokens / 最大输出令牌数 */
  maxOutputTokens: number;
}

/**
 * Provider API interface
 * 提供者 API 接口
 */
export interface ProviderApi {
  /**
   * Lists all available providers
   * 列出所有可用的提供者
   *
   * @returns Array of provider info / 提供者信息数组
   */
  list(): Promise<ProviderInfo[]>;

  /**
   * Lists all available models across all providers
   * 列出所有提供者的所有可用模型
   *
   * @returns Array of full model info / 完整模型信息数组
   */
  listModels(): Promise<FullModelInfo[]>;

  /**
   * Refreshes provider cache and rediscovers models
   * 刷新提供者缓存并重新发现模型
   *
   * @returns Refresh result with counts / 刷新结果及计数
   */
  refresh(): Promise<{ success: boolean; providers: number; models: number }>;
}

/**
 * Backend provider response
 * 后端提供者响应
 */
interface BackendProviderResponse {
  id: string;
  name: string;
  models: Array<{
    id: string;
    name: string;
    context_length: number;
    max_output_tokens: number;
  }>;
}

/**
 * Backend model response
 * 后端模型响应
 */
interface BackendModelResponse {
  id: string;
  name: string;
  provider: string;
  context_length: number;
  max_output_tokens: number;
}

/**
 * Converts backend provider response to frontend ProviderInfo
 * 将后端提供者响应转换为前端 ProviderInfo
 */
function toProviderInfo(response: BackendProviderResponse): ProviderInfo {
  return {
    id: response.id,
    name: response.name,
    models: response.models.map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      maxOutputTokens: m.max_output_tokens,
    })),
  };
}

/**
 * Converts backend model response to frontend FullModelInfo
 * 将后端模型响应转换为前端 FullModelInfo
 */
function toFullModelInfo(response: BackendModelResponse): FullModelInfo {
  return {
    id: response.id,
    name: response.name,
    provider: response.provider,
    contextLength: response.context_length,
    maxOutputTokens: response.max_output_tokens,
  };
}

/**
 * Creates a provider API instance bound to a TalorClient
 * 创建绑定到 TalorClient 的提供者 API 实例
 *
 * @param client - The TalorClient instance / TalorClient 实例
 * @returns Provider API object / 提供者 API 对象
 */
export function createProviderApi(client: TalorClient): ProviderApi {
  return {
    /**
     * Lists all available providers
     * 列出所有可用的提供者
     *
     * GET /api/providers
     *
     * @returns Array of provider info / 提供者信息数组
     */
    async list(): Promise<ProviderInfo[]> {
      const response = await client.get<BackendProviderResponse[]>('/api/providers');
      return response.map(toProviderInfo);
    },

    /**
     * Lists all available models across all providers
     * 列出所有提供者的所有可用模型
     *
     * GET /api/provider/models
     *
     * @returns Array of full model info / 完整模型信息数组
     */
    async listModels(): Promise<FullModelInfo[]> {
      const response = await client.get<BackendModelResponse[]>('/api/provider/models');
      return response.map(toFullModelInfo);
    },

    /**
     * Refreshes provider cache and rediscovers models
     * 刷新提供者缓存并重新发现模型
     *
     * POST /api/providers/refresh
     *
     * @returns Refresh result with counts / 刷新结果及计数
     */
    async refresh(): Promise<{ success: boolean; providers: number; models: number }> {
      return await client.post<{ success: boolean; providers: number; models: number }>(
        '/api/providers/refresh',
        {}
      );
    },
  };
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default createProviderApi;
