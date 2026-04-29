// src/shared/types/permissions.ts — 权限系统共享类型
//
// 采用 Claude Code 的 `ToolName(argPattern)` 统一 DSL：
//   - 所有规则共享同一 shape：(tool, argPattern, effect, scope)
//   - 底层按 tool 分派两类 matcher：
//       bash          → argPattern 是正则 source（必须 ^...$ 双端锚）
//       file tools    → argPattern 是绝对路径；尾 '/' = 目录前缀匹配，否则精确匹配
//
// MCP 工具不参与本系统：启用一个 MCP server 即视为授权其所有工具。

/** 一条权限规则。 */
export interface PermissionRule {
  id: string
  /**
   * 适用的工具名。支持的工具：
   *   - 'bash'                                          (argPattern: regex source)
   *   - 'read' | 'write' | 'edit' | 'ls' | 'glob' | 'grep'  (argPattern: absolute path)
   */
  tool: string
  /** 按 tool 类型语法不同——见文件头部说明。 */
  argPattern: string
  effect: 'allow' | 'deny'
  /** 'session' 仅内存保留，进程退出即失；'persisted' 写入 per-workspace 文件。 */
  scope: 'session' | 'persisted'
  createdAt: string
}

/** Persisted 规则的落盘格式（per-workspace）。 */
export interface WorkspacePermissions {
  workspacePath: string
  rules: PermissionRule[]        // 只含 scope='persisted'
  schemaVersion: 1
}

/** UI 授权对话框的一档建议 pattern。 */
export interface PatternSuggestion {
  /** 稳定 id，用户选完回传，便于后端区分。 */
  id: 'exact' | 'parent_dir' | 'top_dir' | 'same_binary' | 'same_subcommand'
  /** 人可读文案，UI 直接展示。 */
  label: string
  /** 实际写入规则的 pattern 字符串。 */
  pattern: string
  /** UI 用于展示"这个规则会匹配/不匹配什么"的预览。 */
  preview: {
    matches: string[]       // 正例，<= 3 条
    doesNotMatch: string[]  // 反例，<= 3 条
  }
}

/** 主进程向渲染进程发起权限请求时的 payload。 */
export interface PermissionRequest {
  /** 本次请求的唯一 id（对齐 Promise）。 */
  requestId: string
  /** 触发权限请求的工具名。 */
  toolName: string
  /** 上下文原因，UI 据此选择标题与图标。 */
  reason: 'path_outside_workspace' | 'high_risk_tool'
  /** 对用户可读的"这次调用要做什么"的简短摘要（命令原文 / 路径）。 */
  inputSummary: string
  /** 若是 path tool，这里是解析后的绝对路径；否则 undefined。 */
  absPath?: string
  /** 候选 pattern 档位。用户可选"Allow once"或其中一档。 */
  suggestedPatterns: PatternSuggestion[]
  /**
   * 批量授权候选工具组（仅当 reason='path_outside_workspace' 且 toolName 是
   * 只读 file 工具时非空）。UI 勾选框默认全选，提交后后端为每个勾选工具各写
   * 一条规则。
   */
  bulkGrantGroup?: string[]
}

/** 渲染进程回复主进程的授权决定。 */
export interface PermissionResponse {
  requestId: string
  decision: 'approved' | 'rejected'
  /**
   * 若 approved 且用户选了某档 pattern，这里是 PatternSuggestion.id。
   * undefined 表示"Allow once"——不写入规则。
   */
  grantPatternId?: PatternSuggestion['id']
  /** 是否把规则写入持久化层。仅当 grantPatternId 非空时有意义。 */
  rememberAcrossSessions?: boolean
  /** 用户勾选的批量授权工具子集（如 ['read','ls','glob']）。 */
  bulkGrantTools?: string[]
}

/** 给 UI 展示用的规则列表视图。 */
export interface PermissionRuleView {
  session: PermissionRule[]
  persisted: PermissionRule[]
}
