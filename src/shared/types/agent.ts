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

export interface AgentDependencies {
  tools: ToolDependency[]
  mcpServers: McpServerDependency[]
  skills: SkillDependencyGroup[]
  cli: CliDependency[]
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
