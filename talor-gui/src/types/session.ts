/**
 * Session types for Talor GUI
 * 会话相关类型定义
 *
 * @requirements 2.1 - 会话管理
 */

/**
 * Complete session data including metadata
 * 完整的会话数据，包含元数据
 */
export interface Session {
  /** Unique session identifier / 会话唯一标识符 */
  id: string;
  /** Session title / 会话标题 */
  title: string;
  /** Creation timestamp (Unix milliseconds) / 创建时间戳（Unix毫秒） */
  createdAt: number;
  /** Last update timestamp (Unix milliseconds) / 最后更新时间戳（Unix毫秒） */
  updatedAt: number;
  /** Additional session metadata / 额外的会话元数据 */
  metadata: Record<string, unknown>;
}

/**
 * Session summary information for list display
 * 用于列表显示的会话摘要信息
 */
export interface SessionInfo {
  /** Unique session identifier / 会话唯一标识符 */
  id: string;
  /** Session title / 会话标题 */
  title: string;
  /** Creation timestamp (Unix milliseconds) / 创建时间戳（Unix毫秒） */
  createdAt: number;
  /** Last update timestamp (Unix milliseconds) / 最后更新时间戳（Unix毫秒） */
  updatedAt: number;
  /** Number of messages in the session / 会话中的消息数量 */
  messageCount: number;
}
