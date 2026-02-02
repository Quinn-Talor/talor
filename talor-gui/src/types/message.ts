/**
 * Message types for Talor GUI
 * 消息相关类型定义
 *
 * @requirements 3.1 - 消息展示
 */

/**
 * Message role types
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Tool call information
 * 工具调用信息
 */
export interface ToolCall {
  /** Unique tool call identifier / 工具调用唯一标识符 */
  id: string;
  /** Tool name / 工具名称 */
  name: string;
  /** Tool arguments / 工具参数 */
  arguments: Record<string, unknown>;
}

/**
 * Tool execution result
 * 工具执行结果
 */
export interface ToolResult {
  /** Reference to the tool call ID / 关联的工具调用ID */
  toolCallId: string;
  /** Tool output / 工具输出 */
  output: string;
  /** Error message if execution failed / 执行失败时的错误信息 */
  error?: string;
}

/**
 * Chat message in a session
 * 会话中的聊天消息
 */
export interface Message {
  /** Unique message identifier / 消息唯一标识符 */
  id: string;
  /** Session this message belongs to / 消息所属的会话ID */
  sessionId: string;
  /** Message role (user, assistant, system, tool) / 消息角色 */
  role: MessageRole;
  /** Message content / 消息内容 */
  content: string;
  /** Creation timestamp (Unix milliseconds) / 创建时间戳（Unix毫秒） */
  createdAt: number;
  /** Tool calls made by the assistant / 助手发起的工具调用 */
  toolCalls?: ToolCall[];
  /** Results from tool executions / 工具执行结果 */
  toolResults?: ToolResult[];
}
