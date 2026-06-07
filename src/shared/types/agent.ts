// src/shared/types/agent.ts — 共享类型：Agent 极简 schema
//
// 设计原则:
//   - 8 字段极简: 3 元数据 + 1 prompt + 4 能力(tools/mcp/skills/subagents)
//   - 必填: id, name, description, agentPrompt
//   - 行为面统一在 agentPrompt (自由 markdown,磁盘上是 sibling prompt.md)
//   - 依赖三件套(skills/mcpServers/subagents)全是 name 引用
//   - 删去: schemaVersion / version / avatar / cli / references / preferences(无消费 / 价值低)

// ═══ AgentProfile 顶层 ═══════════════════════════════════════
export interface AgentProfile {
  // ── 元数据 ──
  id: string
  name: string
  /**
   * 多行叙述。三段紧凑成文：
   *   1. 一句话身份（UI 列表 / delegate listing 截断显示）
   *   2. 会做什么（2-5 条短句）
   *   3. 不会做什么（2-5 条短句；命中应礼貌拒绝）
   */
  description: string

  // ── 行为定义（自由 markdown,磁盘上 prompt.md） ──
  /**
   * 完整 agent 操作手册。承载输入引导、工作流、原则、输出格式、风格。
   * 渲染时整段塞进 system prompt。
   */
  agentPrompt: string

  // ── 能力:tools(内置) + mcpServers + skills + subagents ──
  /** 内置工具白名单 */
  tools?: BuiltinToolName[]
  /** 平台 ~/.talor/skills/ 下的 skill name 引用 */
  skills?: string[]
  /** mcp_servers DB 表中的 server name 引用(用户在 Settings 配置) */
  mcpServers?: string[]
  /** delegate_agent 工具的 scope 配置 */
  subagents?: AgentCollaboration
}

// ═══ 子结构 ═══════════════════════════════════════════════════

export type BuiltinToolName = 'read' | 'write' | 'edit' | 'bash' | 'glob' | 'grep' | 'ls'

export const BUILTIN_TOOL_NAMES: readonly BuiltinToolName[] = [
  'read',
  'write',
  'edit',
  'bash',
  'glob',
  'grep',
  'ls',
] as const

export interface AgentCollaboration {
  ids?: SubagentRef[]
  /** true 时可委托所有已注册业务 agent;与 ids 同时声明 ids 优先 */
  allowAny?: boolean
}
export interface SubagentRef {
  id: string
  required: boolean
  purpose?: string
}

// ═══ 运行时辅助类型 ════════════════════════════════════════════
export type AgentStatus = 'disabled' | 'ready' | 'dependency_missing' | 'running'

export interface AgentEntry {
  profile: AgentProfile
  dirPath: string
  status: AgentStatus
  lastUsedAt?: string
}

export interface ValidatorIssue {
  severity: 'error' | 'warn'
  /** 规则编号 */
  rule: number
  /** JSON path */
  path: string
  message: string
}

export interface ValidateProfileSuccess {
  valid: true
  profile: AgentProfile
  warnings: ValidatorIssue[]
}
export interface ValidateProfileFailure {
  valid: false
  errors: ValidatorIssue[]
  warnings: ValidatorIssue[]
}
export type ValidateProfileResult = ValidateProfileSuccess | ValidateProfileFailure

// ═══ 账户管理 (保留,与 schema 无关) ════════════════════════════
export interface AccountKey {
  name: string
  value: string
  secret: boolean
}
export interface Account {
  service: string
  keys: AccountKey[]
}
export interface AccountsData {
  accounts: Account[]
}
export interface ResolveResult {
  resolved: Record<string, string>
  missing: string[]
}

// ═══ 依赖检查类型 ═══════════════════════════════════════════
export type DependencyStepName = 'skill' | 'mcpServer' | 'subagent' | 'complete'

export interface DependencyStepResult {
  step: DependencyStepName
  status: 'pass' | 'missing' | 'fail'
  message?: string
  details?: string[]
}

export interface DependencyCheckResult {
  passed: boolean
  steps: DependencyStepResult[]
}

// ═══ Skill 安装 (保留) ═══════════════════════════════════════
export interface SkillInstallProgress {
  skill: string
  status: 'installing' | 'installed' | 'failed'
  installHint?: string
}

export interface SkillInstallResult {
  installed: string[]
  failed: Array<{ name: string; hint: string }>
}
