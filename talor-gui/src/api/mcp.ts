/**
 * MCP API Module
 * MCP API 模块
 *
 * Provides MCP (Model Context Protocol) server management API calls
 * for the Talor GUI client.
 * 为 Talor GUI 客户端提供 MCP（模型上下文协议）服务器管理 API 调用。
 *
 * @requirements 5.1 - MCP 服务器管理
 */

import type { TalorClient } from './client';

/**
 * MCP server status
 * MCP 服务器状态
 */
export type MCPServerStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * MCP server information
 * MCP 服务器信息
 */
export interface MCPServerInfo {
  /** Server name / 服务器名称 */
  name: string;
  /** Server status / 服务器状态 */
  status: MCPServerStatus;
  /** Number of tools provided by this server / 此服务器提供的工具数量 */
  toolsCount: number;
}

/**
 * MCP server configuration
 * MCP 服务器配置
 */
export interface MCPServerConfig {
  /** Command to run the server / 运行服务器的命令 */
  command: string;
  /** Command arguments / 命令参数 */
  args?: string[];
  /** Environment variables / 环境变量 */
  env?: Record<string, string>;
}

/**
 * MCP tool information
 * MCP 工具信息
 */
export interface MCPToolInfo {
  /** Tool name / 工具名称 */
  name: string;
  /** Tool description / 工具描述 */
  description: string;
  /** Tool input schema / 工具输入模式 */
  inputSchema: Record<string, unknown>;
  /** Server that provides this tool / 提供此工具的服务器 */
  server: string;
}

/**
 * MCP API interface
 * MCP API 接口
 */
export interface MCPApi {
  /**
   * Lists all MCP servers
   * 列出所有 MCP 服务器
   *
   * @returns Array of MCP server info / MCP 服务器信息数组
   */
  listServers(): Promise<MCPServerInfo[]>;

  /**
   * Connects to an MCP server
   * 连接到 MCP 服务器
   *
   * @param name - Server name / 服务器名称
   * @param config - Server configuration / 服务器配置
   * @returns Connection result / 连接结果
   */
  connect(name: string, config: MCPServerConfig): Promise<{ status: string; error?: string }>;

  /**
   * Disconnects from an MCP server
   * 断开与 MCP 服务器的连接
   *
   * @param name - Server name / 服务器名称
   */
  disconnect(name: string): Promise<void>;

  /**
   * Lists all tools from MCP servers
   * 列出所有 MCP 服务器的工具
   *
   * @returns Array of MCP tool info / MCP 工具信息数组
   */
  listTools(): Promise<MCPToolInfo[]>;
}

/**
 * Backend MCP server response
 * 后端 MCP 服务器响应
 */
interface BackendMCPServerResponse {
  name: string;
  status: string;
  tools_count: number;
}

/**
 * Backend MCP tool response
 * 后端 MCP 工具响应
 */
interface BackendMCPToolResponse {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  server: string;
}

/**
 * Converts backend MCP server response to frontend MCPServerInfo
 * 将后端 MCP 服务器响应转换为前端 MCPServerInfo
 */
function toMCPServerInfo(response: BackendMCPServerResponse): MCPServerInfo {
  return {
    name: response.name,
    status: response.status as MCPServerStatus,
    toolsCount: response.tools_count,
  };
}

/**
 * Converts backend MCP tool response to frontend MCPToolInfo
 * 将后端 MCP 工具响应转换为前端 MCPToolInfo
 */
function toMCPToolInfo(response: BackendMCPToolResponse): MCPToolInfo {
  return {
    name: response.name,
    description: response.description,
    inputSchema: response.input_schema,
    server: response.server,
  };
}

/**
 * Creates an MCP API instance bound to a TalorClient
 * 创建绑定到 TalorClient 的 MCP API 实例
 *
 * @param client - The TalorClient instance / TalorClient 实例
 * @returns MCP API object / MCP API 对象
 */
export function createMCPApi(client: TalorClient): MCPApi {
  return {
    /**
     * Lists all MCP servers
     * 列出所有 MCP 服务器
     *
     * GET /api/mcp/servers
     *
     * @returns Array of MCP server info / MCP 服务器信息数组
     */
    async listServers(): Promise<MCPServerInfo[]> {
      const response = await client.get<BackendMCPServerResponse[]>('/api/mcp/servers');
      return response.map(toMCPServerInfo);
    },

    /**
     * Connects to an MCP server
     * 连接到 MCP 服务器
     *
     * POST /api/mcp/servers/:name/connect
     *
     * @param name - Server name / 服务器名称
     * @param config - Server configuration / 服务器配置
     * @returns Connection result / 连接结果
     */
    async connect(name: string, config: MCPServerConfig): Promise<{ status: string; error?: string }> {
      return client.post<{ status: string; error?: string }>(
        `/api/mcp/servers/${encodeURIComponent(name)}/connect`,
        config
      );
    },

    /**
     * Disconnects from an MCP server
     * 断开与 MCP 服务器的连接
     *
     * POST /api/mcp/servers/:name/disconnect
     *
     * @param name - Server name / 服务器名称
     */
    async disconnect(name: string): Promise<void> {
      await client.post<void>(`/api/mcp/servers/${encodeURIComponent(name)}/disconnect`);
    },

    /**
     * Lists all tools from MCP servers
     * 列出所有 MCP 服务器的工具
     *
     * GET /api/mcp/tools
     *
     * @returns Array of MCP tool info / MCP 工具信息数组
     */
    async listTools(): Promise<MCPToolInfo[]> {
      const response = await client.get<BackendMCPToolResponse[]>('/api/mcp/tools');
      return response.map(toMCPToolInfo);
    },
  };
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default createMCPApi;
