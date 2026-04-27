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
  constraints: string[]
  outputFormat: string
  personality?: string
  language?: string
  sampleConversations: SampleConversation[]
}

export interface KnowledgeFileRef {
  path: string
  description: string
  required: boolean
  format?: 'markdown' | 'text' | 'csv' | 'json' | 'pdf'
}

export interface AgentKnowledge {
  files: KnowledgeFileRef[]
}

export interface ToolDependency {
  name: string
  required: boolean
}

export interface SkillDependencySource {
  type: 'npm' | 'git' | 'url'
  package?: string
  url?: string
}

export interface SkillDependency {
  name: string
  version?: string
  required: boolean
  source?: SkillDependencySource
  config?: Record<string, string>
}

export interface CliDependency {
  command: string
  version?: string
  checkCommand?: string
  installHint?: string
  required: boolean
}

export interface AgentDependencies {
  tools: ToolDependency[]
  skills: SkillDependency[]
  cli: CliDependency[]
}

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

export interface AgentRuntime {
  providerId?: string
  modelId?: string
  maxSteps?: number
  contextLimit?: number
}

export interface AgentManifest {
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
  runtime?: AgentRuntime
}

export type AgentStatus = 'disabled' | 'ready' | 'dependency_missing' | 'running'

export interface AgentEntry {
  manifest: AgentManifest
  dirPath: string
  status: AgentStatus
  lastUsedAt?: string
  resolvedConfig?: Record<string, string>
}

export interface ValidateManifestSuccess {
  valid: true
  manifest: AgentManifest
}

export interface ValidateManifestFailure {
  valid: false
  errors: string[]
}

export type ValidateManifestResult = ValidateManifestSuccess | ValidateManifestFailure

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

export type DependencyStepName =
  | 'minAppVersion'
  | 'cli'
  | 'skill'
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

export interface SkillInstallProgress {
  skill: string
  status: 'installing' | 'installed' | 'failed'
  installHint?: string
}

export interface SkillInstallResult {
  installed: string[]
  failed: Array<{ name: string; hint: string }>
}
