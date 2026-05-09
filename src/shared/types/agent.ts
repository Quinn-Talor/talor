// src/shared/types/agent.ts — 共享类型：Agent 系统核心类型定义 (Schema 1.0)
//
// AgentProfile = agent.json 的 TS 映射（Agent 的档案）
// 所有 Agent 模块基于此统一数据结构
//
// Schema 1.0 设计原则：
//   - 五段顶层 (identity / mission / method / delivery / execution) + 可选 preferences
//   - 字段三分流：LLM-prompt / API tools 参数 / 代码 guard
//   - 无向后兼容：旧 schema profile 直接 reject

// ── Schema 版本 ──────────────────────────────────────────
export const SCHEMA_VERSION = '1.0' as const

// ── Identity 段 ──────────────────────────────────────────

export interface AgentIdentity {
  /** snake_case, ^[a-z0-9_-]+$，平台 agent 用 __xxx__ 包裹 */
  id: string
  /** 显示名称 */
  name: string
  /** 一句话描述 */
  description: string
  /** semver */
  version: string
  /** 最低应用版本要求,semver */
  minAppVersion?: string
  /** 头像（仅 UI 用） */
  avatar?: string
}

// ── Mission 段（业务锚） ────────────────────────────────────

export type Severity = 'must' | 'should'

export interface AgentMission {
  /** 一句话业务目标（north star） */
  objective: string
  /** 可验证的预期结果列表。平台 agent (id 匹配 /^__.*__$/) 允许为空 */
  outcomes: Outcome[]
  /** ★ 业务 agent 启动需要的输入：缺失时引导用户提供 */
  inputs?: MissionInput[]
  /** 边界声明（会做 / 不会做）。渲染到 prompt 强约束 LLM；不声明视为无边界 */
  scope?: AgentScope
}

/** Mission 边界：会做/不会做的具体行为列表，3-7 条最佳。渲染到 system prompt。 */
export interface AgentScope {
  /** "会做"：3-7 条具体行为 */
  in: string[]
  /** "不会做"：3-7 条边界外的事；LLM 命中应拒绝并解释 */
  out: string[]
}

export interface Outcome {
  /** snake_case */
  id: string
  /** 可验证的结果描述 */
  description: string
  /** 优先级，default 'core' */
  priority?: 'core' | 'auxiliary'
  /** 验证方式：至少一条 severity='must' 且 kind ∈ {deterministic, human} */
  verifyBy: AcceptanceCriterion[]
}

/** ★ Mission Input：业务 agent 引导用户提供的必需输入 */
export interface MissionInput {
  /** snake_case, mission 内唯一 */
  id: string
  /** 解释这个输入是什么 */
  description: string
  /** 输入类型 */
  type: 'text' | 'file' | 'url' | 'structured'
  /** 是否必需。required=true 时 prompt 引导 LLM 必须先收齐再产出 deliverable */
  required: boolean
  /** 示例值，渲染到 prompt 帮助 LLM 理解 */
  examples?: string[]
}

// ── Method 段（工作方法） ───────────────────────────────────

export interface AgentMethod {
  /** 能力声明,渲染到 prompt; 与 outcomes 关键词应有重叠（validator §13 warn） */
  capabilities: string[]
  knowledge?: KnowledgeRef[]
  /** 工具白/黑名单。未列出的工具按 ALWAYS_AVAILABLE_TOOLS 默认行为；列出 = override */
  tools?: ToolDependency[]
  mcpServers?: McpServerDependency[]
  skills?: SkillItem[]
  cli?: CliDependency[]
  workflow?: WorkflowSpec
  collaboration?: AgentCollaboration
  /** 语气描述 */
  personality?: string
  /** 语言 */
  language?: string
}

/** Knowledge 引用：union type 区分文件/内嵌文本/URL */
export type KnowledgeRef =
  | {
      type: 'file'
      path: string
      description: string
      format?: 'markdown' | 'text' | 'csv' | 'json' | 'pdf'
      /** required=true 时 validator §15 自动注入 implicit acceptance (must read) */
      required?: boolean
    }
  | { type: 'text'; content: string; description: string }
  | { type: 'url'; url: string; description: string; cache?: boolean }

/**
 * v8.1: method.tools 仅声明内置工具白名单。
 * 元工具 (search_tool / skill / delegate_agent) 由其它字段派生:
 *   - search_tool ← method.mcpServers 非空 OR 平台已有 MCP 工具
 *   - skill       ← method.skills 非空
 *   - delegate_agent ← 总是注入,scope 由 method.collaboration 决定
 */
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

/** 工具依赖：仅限内置工具。元工具不在此列。 */
export interface ToolDependency {
  /** 内置工具名 (read/write/edit/bash/glob/grep/ls) */
  name: BuiltinToolName
  /** disabled=true 时 agent-toolset 物理过滤,LLM 看不到 */
  disabled?: boolean
  /** required=true 时 dependency-checker 启动期校验 */
  required?: boolean
  /** 人类元数据（profile 文档化用,不进 prompt 不进 API description） */
  purpose?: string
}

export interface AgentCollaboration {
  /** 显式声明可委托的 subagent 列表（受限 scope） */
  subagents?: SubagentDependency[]
  /** 默认 false。true 时可委托所有已注册业务 agent；与 subagents 同时声明则前者优先（log.warn） */
  allowAnyBusinessSubagent?: boolean
}

export interface SubagentDependency {
  /** 被依赖的 agent_id（必须是某个已注册业务 agent） */
  id: string
  /** required=true 时,依赖缺失会让此 agent 标记为 dependency_missing */
  required: boolean
  /** 该 subagent 在当前 agent 工作流里的角色描述（写入 listing 让 LLM 知道何时调） */
  purpose?: string
}

// ── MCP / Skill / CLI（保留,字段路径下挪到 method.* 由 dependency-checker 处理）──

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

/**
 * Schema 1.0: skill 引用极简化 — 只声明意图(name + required + 可选 purpose)。
 * 安装来源不再写在 profile 里,由 Talor 装配阶段解析:
 *   1. 全局位置依次扫描:~/.claude/skills/<name>/ → ~/.skills/<name>/ → ~/.agents/skills/<name>/
 *   2. 命中 → cpSync 到 <agent_dir>/skills/<name>/(自包含,可导出 .talor-pack)
 *   3. 全部未命中 → log warn,dep-checker 标 missing,UI 提示用户手动放到 ~/.claude/skills/<name>/
 */
export interface SkillItem {
  name: string
  required: boolean
  /** 人类元数据,描述 agent 为何需要此 skill,不影响装配 */
  purpose?: string
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

// ── Workflow（DAG，runtime 是软引导，校验是 load 时） ─────────

export interface WorkflowSpec {
  /** 流程类型。default 'sequence'。reactive=纯 ReAct,无固定步骤 */
  kind?: 'sequence' | 'dag' | 'reactive'
  steps: WorkflowStep[]
}

/** WorkflowStep 在该步骤上调用到的依赖（每个数组元素必须在 method.* 中声明）。 */
export interface WorkflowStepUse {
  tools?: string[]
  skills?: string[]
  mcpServers?: string[]
  cli?: string[]
}

export interface WorkflowStep {
  /** snake_case */
  id: string
  description: string
  /** 步骤类型。default 'task'。 */
  kind?: 'task' | 'wait_for_user_approval' | 'branch' | 'loop'
  /** 该步骤使用的依赖（唯一来源）。validator §16 校验每项必须在 method.* 声明 */
  use?: WorkflowStepUse
  /** 数据流上游：'user-input' 哨兵或上游 stepOutput id */
  inputs?: string[]
  /** 产出物：deliverable.id 或中间 stepOutput id */
  produces?: string
  /** 控制流上游：必须先完成的 step id */
  requires?: string[]
  /** kind='branch' 时的判定字段或表达式 */
  branchOn?: string
  /** kind='loop' 时的退出条件 */
  loopWhile?: string
  /** default false */
  optional?: boolean
}

// ── Delivery 段（交付契约） ─────────────────────────────────
//
// v8: 移除 delivery.acceptance — acceptance 统一由 mission.outcomes[].verifyBy 提供。
// 装配阶段 buildResolvedAcceptance 平铺所有 outcomes.verifyBy + implicit (knowledge required)。

export interface AgentDelivery {
  /** 平台 agent 允许为空数组 */
  deliverables: Deliverable[]
}

export interface Deliverable {
  /** snake_case */
  id: string
  format: 'markdown' | 'json' | 'structured' | 'text'
  /** JSON Schema (Ajv)。schema 与 mustContain 至少有一个 */
  schema?: object
  /** 输出必须包含的 regex 列表 */
  mustContain?: string[]
  /** 抽取规则。缺省时按 format 推默认（json → json-fenced-block, 其它 → last-message） */
  extractFrom?: ExtractRule
  /** 质量准则,渲染为 # Quality Pledges 独立段；支持 ✓/✗ 标记 */
  rubric?: string[]
  /** 何时产出,渲染到 prompt */
  trigger?: string
  /** 输出骨架（供 LLM 参考） */
  template?: string
  /** default true */
  required?: boolean
}

/** ExtractRule：从 LLM 输出抽取 deliverable 的规则 */
export type ExtractRule =
  | { type: 'last-message' }
  | { type: 'json-fenced-block'; firstOrLast?: 'first' | 'last' }
  | { type: 'regex-capture'; pattern: string; group?: number }
  | { type: 'tool-result'; toolName: string }

/** AcceptanceCriterion：discriminated union，8 个 type 变体 */
export type AcceptanceCriterion =
  | {
      type: 'deliverable-present'
      deliverableId: string
      kind: 'deterministic'
      severity?: Severity
      _implicit?: boolean
      _knowledgePath?: string
    }
  | {
      type: 'tool-was-used'
      toolName: string
      kind: 'deterministic'
      severity?: Severity
      _implicit?: boolean
      _knowledgePath?: string
    }
  | {
      type: 'tool-not-used'
      toolName: string
      kind: 'deterministic'
      severity?: Severity
    }
  | {
      type: 'tool-not-failed'
      toolName: string
      kind: 'deterministic'
      severity?: Severity
    }
  | {
      type: 'output-matches'
      schema?: object
      pattern?: string
      kind: 'deterministic'
      severity?: Severity
    }
  | {
      type: 'verifier-tool'
      toolName: string
      args?: unknown
      kind: 'deterministic' | 'semantic'
      severity?: Severity
    }
  | {
      type: 'llm-judge'
      judgePrompt: string
      judgeModel?: string
      votes?: number
      kind: 'semantic'
      severity?: Severity
    }
  | {
      type: 'human-approval'
      approverRef: string
      kind: 'human'
      severity?: Severity
    }

// ── Execution 段（代码 guard，不进 prompt） ──────────────────

export interface AgentExecution {
  limits: AgentLimits
  retryPolicy: RetryPolicy
}

export interface AgentLimits {
  /** ReAct iteration 上限 */
  maxSteps: number
  /** 累计 token 上限 */
  maxTokens: number
}

export interface RetryPolicy {
  /** 默认 2，含首次 */
  maxAttempts: number
  /** must 失败处理：retry-then-mark | retry-then-escalate | abort */
  onMustFail: 'retry-then-mark' | 'retry-then-escalate' | 'abort'
  /** should 失败处理：mark-only | retry-once */
  onShouldFail: 'mark-only' | 'retry-once'
  /** onMustFail='retry-then-escalate' 时必填 */
  escalateTo?: AgentRef
}

export interface AgentRef {
  id: string
  purpose?: string
}

// ── Preferences 段（运行时偏好，可选） ─────────────────────

export interface AgentPreferences {
  /** 锁定模型；不填则用 DEFAULT_MODEL */
  modelId?: string
  /** 锁定 provider；不填则用 DEFAULT_PROVIDER */
  providerId?: string
}

// ── AgentProfile（agent.json 的完整映射） ─────────────────

export interface AgentProfile {
  schemaVersion: typeof SCHEMA_VERSION
  identity: AgentIdentity
  mission: AgentMission
  method: AgentMethod
  delivery: AgentDelivery
  execution: AgentExecution
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

export interface ValidatorIssue {
  severity: 'error' | 'warn'
  /** 规则编号(1..17)。0 = 输入级错误（非对象等） */
  rule: number
  /** JSON path，如 'mission.outcomes[0].verifyBy' */
  path: string
  message: string
}

export interface ValidateProfileSuccess {
  valid: true
  /** 经默认值填充后的 profile（如 deliverable.extractFrom 默认值） */
  profile: AgentProfile
  warnings: ValidatorIssue[]
}

export interface ValidateProfileFailure {
  valid: false
  errors: ValidatorIssue[]
  warnings: ValidatorIssue[]
}

export type ValidateProfileResult = ValidateProfileSuccess | ValidateProfileFailure

// ── 账户管理（保留） ─────────────────────────────────────

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

// ── 依赖检查（保留） ─────────────────────────────────────

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

// ── Skill 安装（保留） ───────────────────────────────────

export interface SkillInstallProgress {
  skill: string
  status: 'installing' | 'installed' | 'failed'
  installHint?: string
}

export interface SkillInstallResult {
  installed: string[]
  failed: Array<{ name: string; hint: string }>
}
