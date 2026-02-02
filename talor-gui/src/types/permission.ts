/**
 * Permission types for Talor GUI
 * 权限相关类型定义
 *
 * @requirements 5.1 - 权限管理
 */

/**
 * Permission request from the agent
 * 代理发起的权限请求
 */
export interface PermissionRequest {
  /** Unique request identifier / 请求唯一标识符 */
  id: string;
  /** Session ID where the request originated / 请求来源的会话ID */
  sessionId: string;
  /** Name of the tool requesting permission / 请求权限的工具名称 */
  toolName: string;
  /** Tool arguments / 工具参数 */
  arguments: Record<string, unknown>;
  /** Human-readable description of the action / 操作的人类可读描述 */
  description: string;
}

/**
 * Permission action type
 * 权限操作类型
 */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * Permission scope type
 * 权限范围类型
 */
export type PermissionScope = 'once' | 'session' | 'always';

/**
 * Permission rule for automatic handling
 * 自动处理的权限规则
 */
export interface PermissionRule {
  /** Tool name pattern (supports wildcards) / 工具名称模式（支持通配符） */
  toolPattern: string;
  /** Action to take when pattern matches / 模式匹配时采取的操作 */
  action: PermissionAction;
  /** Scope of the rule / 规则的范围 */
  scope: PermissionScope;
}

/**
 * Permission response from user
 * 用户的权限响应
 */
export interface PermissionResponse {
  /** Request ID being responded to / 响应的请求ID */
  requestId: string;
  /** Whether permission was granted / 是否授予权限 */
  approved: boolean;
  /** Scope of the permission grant / 权限授予的范围 */
  scope?: PermissionScope;
}
