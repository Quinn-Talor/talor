/**
 * API response types for Talor GUI
 * API响应相关类型定义
 *
 * @requirements 3.1 - 消息展示
 */

/**
 * Agent response type enumeration
 * 代理响应类型枚举
 */
export type AgentResponseType = 'text' | 'tool_call' | 'tool_result' | 'error' | 'status';

/**
 * Agent response from the backend
 * 后端返回的代理响应
 */
export interface AgentResponse {
  /** Response type / 响应类型 */
  type: AgentResponseType;
  /** Response content (string for text/error/status, object for tool_call/tool_result) / 响应内容 */
  content: string | Record<string, unknown>;
  /** Additional metadata / 额外的元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for processing a prompt
 * 处理提示词的参数
 */
export interface ProcessPromptParams {
  /** Session ID / 会话ID */
  sessionId: string;
  /** User prompt / 用户提示词 */
  prompt: string;
  /** Optional model override (format: "provider/model") / 可选的模型覆盖 */
  model?: string;
  /** Optional agent name / 可选的代理名称 */
  agent?: string;
}
