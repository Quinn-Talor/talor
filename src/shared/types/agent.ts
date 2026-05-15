// src/shared/types/agent.ts — 共享类型：Agent Schema 2.0
//
// 设计原则:
//   - 顶层 15 字段扁平结构,无 mission/method/delivery/execution 包装
//   - 6 必填: schemaVersion, id, name, description, version, agentPrompt
//   - 行为面统一在 agentPrompt (自由 markdown)
//   - 仅保留代码真正读、真正用的字段;契约/验证回到 prompt 通路
//   - 与 Claude Agent SDK 形态对齐

export const SCHEMA_VERSION = '2.0' as const

// ═══ AgentProfile 顶层 ═══════════════════════════════════════
export interface AgentProfile {
  schemaVersion: typeof SCHEMA_VERSION

  // ── Manifest ──
  id: string
  name: string
  /**
   * 多行叙述。三段紧凑成文：
   *   1. 一句话身份（UI 列表 / delegate listing 截断显示）
   *   2. 会做什么（2-5 条短句）
   *   3. 不会做什么（2-5 条短句；命中应礼貌拒绝）
   */
  description: string
  version: string
  minAppVersion?: string
  avatar?: string

  // ── 行为定义（自由 markdown） ──
  /**
   * 完整 agent 操作手册。承载输入引导、工作流、原则、输出格式、风格。
   * 渲染时整段塞进 system prompt。
   */
  agentPrompt: string

  // ── 依赖 manifest ──
  tools?: BuiltinToolName[]
  skills?: SkillItem[]
  mcpServers?: McpServerDependency[]
  cli?: CliDependency[]
  /** Agent 专属参考资料(按需 read 加载,不自动注入) */
  references?: ReferenceFile[]
  subagents?: AgentCollaboration

  // ── 运行时偏好 ──
  preferences?: AgentPreferences
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

/**
 * 参考资料文件索引。LLM 看到清单后用 `read` 工具按需加载,不预读。
 * 建议放在 <agent_dir>/references/ 下。
 */
export interface ReferenceFile {
  /** snake_case;agentPrompt 中可用 @<id> 引用 */
  id: string
  /** 相对 agent 根目录的路径;禁止 ../ 越界 */
  path: string
  description: string
}

export interface SkillItem {
  name: string
  required: boolean
  purpose?: string
}

export interface McpServerPackage {
  type: 'npm' | 'pip'
  package: string
}
export interface McpTransportStdio {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}
export interface McpTransportHttp {
  type: 'http'
  url: string
  auth?: { type: 'bearer' | 'apiKey'; envVar: string }
}
export type McpTransportConfig = McpTransportStdio | McpTransportHttp

export interface McpServerDependency {
  name: string
  description?: string
  serverPackage?: McpServerPackage
  transport: McpTransportConfig
  tools: string[]
  required: boolean
}

export interface CliInstallNpm {
  type: 'npm'
  package: string
}
export interface CliInstallBrew {
  type: 'brew'
  formula: string
}
export interface CliInstallScript {
  type: 'script'
  url: string
}
export type CliInstallMethod = CliInstallNpm | CliInstallBrew | CliInstallScript

export interface CliDependency {
  command: string
  version?: string
  checkCommand?: string
  install: CliInstallMethod
  required: boolean
}

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

export interface AgentPreferences {
  modelId?: string
  providerId?: string

  // v4 Phase 1: 采样参数(全部 optional,覆盖 Provider 级默认)
  /** 输出 token 预算。覆盖 provider.max_output_tokens / 全局默认 64K。 */
  maxOutputTokens?: number
  /** 采样温度,默认 provider 决定。 */
  temperature?: number
  /** Nucleus sampling 概率,默认 provider 决定。 */
  topP?: number
  /** 仅测试场景:固定 seed 复现。 */
  seed?: number
  /** 工具选择策略。默认 'auto'。 */
  toolChoice?: 'auto' | 'required' | { type: 'tool'; toolName: string }
  /**
   * v3.7.3 承接:turn-end 二审(judge)配置。
   * Phase 2 + Phase 5 启用,Phase 1 仅记 schema。
   */
  turnEndJudge?: {
    enabled: boolean
    model?: string
    timeoutMs?: number
  }

  /**
   * Reflect 用的便宜 model id (Haiku / gpt-4o-mini / DeepSeek-V3 等)。
   * 未设 → L2 LLM reflector (judge-completion / quote-correction / periodic /
   * escalation) 自动跳过, L1 reflector 仍工作。
   */
  reflectModelId?: string

  /** PeriodicReflector 触发间隔, 默认 5。0 = 关闭周期 reflect。 */
  reflectEveryN?: number
}

// ═══ 运行时辅助类型 (基本沿用) ════════════════════════════════
export type AgentStatus = 'disabled' | 'ready' | 'dependency_missing' | 'running'

export interface AgentEntry {
  profile: AgentProfile
  dirPath: string
  status: AgentStatus
  lastUsedAt?: string
}

export interface ValidatorIssue {
  severity: 'error' | 'warn'
  /** 规则编号(1..9)。0 = 输入级错误 */
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
export type DependencyStepName =
  | 'minAppVersion'
  | 'cli'
  | 'skill'
  | 'mcpServer'
  | 'tool'
  | 'subagent'
  | 'config'
  | 'references' // renamed from 'knowledge'
  | 'complete'

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
