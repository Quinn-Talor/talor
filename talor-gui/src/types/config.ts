/**
 * Configuration types for Talor GUI
 * 配置相关类型定义
 *
 * @requirements 6.1 - 设置配置
 * @requirements 8.1 - 工具状态显示
 */

/**
 * LLM Provider configuration
 * LLM提供商配置
 */
export interface ProviderConfig {
  /** Unique provider identifier / 提供商唯一标识符 */
  id: string;
  /** Provider display name / 提供商显示名称 */
  name: string;
  /** API key for authentication / 认证用的API密钥 */
  apiKey?: string;
  /** Base URL for API requests / API请求的基础URL */
  baseUrl?: string;
  /** Default model for this provider / 此提供商的默认模型 */
  defaultModel?: string;
}

/**
 * MCP Server transport type
 * MCP服务器传输类型
 */
export type MCPTransport = 'stdio' | 'sse';

/**
 * MCP Server configuration
 * MCP服务器配置
 */
export interface MCPServerConfig {
  /** Unique server identifier / 服务器唯一标识符 */
  id: string;
  /** Server display name / 服务器显示名称 */
  name: string;
  /** Command to start the server / 启动服务器的命令 */
  command: string;
  /** Command arguments / 命令参数 */
  args: string[];
  /** Environment variables / 环境变量 */
  env: Record<string, string>;
  /** Transport protocol / 传输协议 */
  transport: MCPTransport;
}

/**
 * Model capability flags (detailed boolean breakdown)
 * 模型能力标志位（详细布尔值）
 */
export interface ModelCapabilityFlags {
  vision: boolean;
  functionCalling: boolean;
  reasoning: boolean;
  streaming: boolean;
  jsonMode: boolean;
  parallelToolCalls: boolean;
  structuredOutput: boolean;
}

/**
 * Model information
 * 模型信息
 */
export interface ModelInfo {
  /** Unique model identifier / 模型唯一标识符 */
  id: string;
  /** Model display name / 模型显示名称 */
  name: string;
  /** Provider ID this model belongs to / 模型所属的提供商ID */
  providerId: string;
  /** Provider display name / 提供商显示名称 */
  providerName: string;
  /** Model capabilities / 模型能力 */
  capabilities: string[];
  /** Detailed capability flags from API / 来自API的详细能力标志 */
  capabilityFlags?: ModelCapabilityFlags;
  /** Context window size in tokens / 上下文窗口大小（tokens） */
  contextLength?: number;
  /** Maximum output tokens / 最大输出token数 */
  maxOutputTokens?: number;
}

/**
 * MCP Server runtime information
 * MCP服务器运行时信息
 */
export interface MCPServerInfo extends MCPServerConfig {
  /** Connection status / 连接状态 */
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** Error message if status is error / 错误状态时的错误信息 */
  error?: string;
}

/**
 * Tool information from MCP server
 * MCP服务器提供的工具信息
 */
export interface Tool {
  /** Tool name / 工具名称 */
  name: string;
  /** Tool description / 工具描述 */
  description: string;
  /** Input schema for the tool / 工具的输入模式 */
  inputSchema: Record<string, unknown>;
  /** Server ID this tool belongs to / 工具所属的服务器ID */
  serverId: string;
}

/**
 * Application configuration
 * 应用配置
 */
export interface Config {
  /** Theme setting / 主题设置 */
  theme?: 'light' | 'dark' | 'system';
  /** Language setting / 语言设置 */
  language?: 'en' | 'zh';
  /** Default model ID / 默认模型ID */
  defaultModel?: string;
  /** Provider configurations / 提供商配置 */
  providers?: ProviderConfig[];
  /** MCP server configurations / MCP服务器配置 */
  mcpServers?: MCPServerConfig[];
  /** Additional configuration options / 额外的配置选项 */
  [key: string]: unknown;
}
