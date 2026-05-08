// src/shared/types/agent.ts — 共享类型：Agent 系统核心类型定义
//
// AgentProfile = agent.json 的 TS 映射（Agent 的档案）
// 所有 Agent 模块基于此统一数据结构

// ── 角色 ──────────────────────────────────────────────────

export interface SampleConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SampleConversation {
  title: string
  messages: SampleConversationMessage[]
}

export interface AgentRole {
  capabilities: string[]
  constraints?: string[]
  outputFormat: string
  sampleConversations?: SampleConversation[]
  personality?: string
  language?: string
}

// ── 知识 ──────────────────────────────────────────────────

export interface KnowledgeFileRef {
  path: string
  description: string
  required: boolean
  format?: 'markdown' | 'text' | 'csv' | 'json' | 'pdf'
}

export interface AgentKnowledge {
  files: KnowledgeFileRef[]
}

// ── 流程（MVP 只支持 manual trigger）─────────────────────

export interface WorkflowStep {
  id: string
  name: string
  instruction: string
  tools?: string[]
  input?: Record<string, string>
  output?: string
  condition?: string
}

export interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'event'
  schedule?: string
  event?: string
}

export interface AgentWorkflow {
  trigger?: WorkflowTrigger
  steps: WorkflowStep[]
  fallback?: string
}

// ── 依赖声明 ─────────────────────────────────────────────

export interface ToolDependency {
  name: string
  required: boolean
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
  auth?: {
    type: 'bearer' | 'apiKey'
    envVar: string
  }
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

export interface SkillSource {
  type: 'npx' | 'local'
  uri?: string
  path?: string
}

export interface SkillItem {
  name: string
  required: boolean
}

export interface SkillDependencyGroup {
  source: SkillSource
  items: SkillItem[]
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

export interface SubagentDependency {
  /** 被依赖的 agent_id（必须是某个已注册业务 agent） */
  id: string
  /** required=true 时，依赖缺失会让此 agent 标记为 dependency_missing */
  required: boolean
  /** 可选：该 subagent 在当前 agent 工作流里的角色描述（写入 listing 让 LLM 知道何时调） */
  purpose?: string
}

export interface AgentDependencies {
  tools: ToolDependency[]
  mcpServers: McpServerDependency[]
  skills: SkillDependencyGroup[]
  cli: CliDependency[]
  /**
   * 工具黑名单。即使工具在 registry 中可用（builtin / MCP / agentTool），
   * 名字落在此集合的不暴露给 LLM（不会出现在 listTools 输出里）。
   *
   * 通用机制，可禁用任意工具。典型用法：
   *   - 安全模式业务 agent 禁用 'bash' / 'write' → 只读 agent
   *
   * 注意：仅过滤 listTools 输出（"暴露给 LLM"）。toolRegistry.execute 路径
   * 不应用此过滤——内部 helper 仍可调用被禁用的工具。
   */
  disabledTools?: string[]
  /**
   * 此 agent 工作时推荐 / 必需的其他 subagent。声明非空时 agent 工作时
   * delegate_agent 工具的 scope 限定到此列表（受限委托）。
   *
   * 抽自含委托对话的业务 agent 在 profile 里以此字段记录依赖关系。
   */
  subagents?: SubagentDependency[]
  /**
   * 允许委托给所有已注册的业务 agent（不受 subagents 列表限制）。
   * 默认 false。
   *
   * 仅用于 `__chat__` 平台 agent 或用户自定义"通用编排 agent"。
   * 与 subagents 互斥时，此字段优先（同时声明会 log.warn）。
   */
  allowAnyBusinessSubagent?: boolean
}

// ── 运行偏好 ─────────────────────────────────────────────

export interface AgentPreferences {
  providerId?: string
  modelId?: string
  maxSteps?: number
  contextLimit?: number
}

// ── AgentProfile（agent.json 的完整映射）─────────────────

export interface AgentProfile {
  id: string
  name: string
  description: string
  avatar?: string
  version: string
  minAppVersion?: string
  role: AgentRole
  knowledge: AgentKnowledge
  workflow?: AgentWorkflow
  dependencies: AgentDependencies
  preferences?: AgentPreferences
}

// ── 运行时辅助类型 ───────────────────────────────────────

export type AgentStatus = 'disabled' | 'ready' | 'dependency_missing' | 'running'

export interface AgentEntry {
  profile: AgentProfile
  dirPath: string
  status: AgentStatus
  lastUsedAt?: string
}

// ── 校验结果 ─────────────────────────────────────────────

export interface ValidateProfileSuccess {
  valid: true
  profile: AgentProfile
}

export interface ValidateProfileFailure {
  valid: false
  errors: string[]
}

export type ValidateProfileResult = ValidateProfileSuccess | ValidateProfileFailure

// ── 账户管理 ─────────────────────────────────────────────

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

// ── 依赖检查 ─────────────────────────────────────────────

export type DependencyStepName =
  | 'minAppVersion'
  | 'cli'
  | 'skill'
  | 'mcpServer'
  | 'tool'
  | 'subagent'
  | 'config'
  | 'knowledge'
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

// ── Skill 安装 ───────────────────────────────────────────

export interface SkillInstallProgress {
  skill: string
  status: 'installing' | 'installed' | 'failed'
  installHint?: string
}

export interface SkillInstallResult {
  installed: string[]
  failed: Array<{ name: string; hint: string }>
}
