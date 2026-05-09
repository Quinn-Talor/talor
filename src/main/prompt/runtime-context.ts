// src/main/prompt/runtime-context.ts — 业务层：模板渲染上下文构造
//
// 把 Agent 实体属性 + iteration 状态 → TemplateContext (供 render.ts 消费)。
//
// 决定哪些段渲染、哪些段省略 (单模板分支渲染)。
//
// 允许依赖: agent/*、shared/*
// 禁止依赖: ipc/*

import type { Agent } from '../agent/agent'
import type {
  AgentIdentity,
  AgentMission,
  AgentMethod,
  AgentDelivery,
  AcceptanceCriterion,
  Outcome,
  Deliverable,
  MissionInput,
  KnowledgeRef,
  WorkflowStep,
  WorkflowSpec,
} from '@shared/types/agent'

/** runtime-context 注入到模板的 knowledge,加 isText/isFile/isUrl flag 供模板 if 用 */
export type EnrichedKnowledge =
  | (Extract<KnowledgeRef, { type: 'file' }> & { isFile: true; isText: false; isUrl: false })
  | (Extract<KnowledgeRef, { type: 'text' }> & { isFile: false; isText: true; isUrl: false })
  | (Extract<KnowledgeRef, { type: 'url' }> & { isFile: false; isText: false; isUrl: true })

export interface RuntimeIterationState {
  /** ReAct iteration 计数 (0-based) */
  iterationNumber: number
  /** 累计 token 用量 (供 ON-DEMAND 触发判断) */
  tokensUsed: number
}

/** method 的 enriched 版本: knowledge 每项加 isText/isFile/isUrl, workflow.steps 加 kind flag */
export interface EnrichedWorkflowStep extends WorkflowStep {
  /** kind='wait_for_user_approval' 时为 true */
  isWaitForApproval: boolean
  /** kind='branch' 时为 true */
  isBranch: boolean
  /** kind='loop' 时为 true */
  isLoop: boolean
  /** "工具 read,write · skill lark-doc" 形式的扁平摘要,空字符串则不渲染 */
  useSummary: string
}

export interface EnrichedWorkflow extends Omit<WorkflowSpec, 'steps'> {
  steps: EnrichedWorkflowStep[]
}

export type EnrichedMethod = Omit<AgentMethod, 'knowledge' | 'workflow'> & {
  knowledge?: EnrichedKnowledge[]
  workflow?: EnrichedWorkflow
}

export interface TemplateContext {
  // ── 基础字段 (供模板直接读) ──
  identity: AgentIdentity
  mission: AgentMission
  method: EnrichedMethod
  delivery: AgentDelivery

  // ── 渲染分支条件 ──
  /** Mission 段是否渲染 */
  hasMissionOutcomes: boolean
  hasCoreOutcomes: boolean
  hasAuxOutcomes: boolean
  coreOutcomes: Outcome[]
  auxOutcomes: Outcome[]

  /** Available Collaborators 段 */
  hasCollaborators: boolean

  /** Required Inputs 段 (业务 agent 引导用户) */
  hasInputs: boolean
  inputs: MissionInput[]

  /** Scope 段 (会做/不会做边界) */
  hasScope: boolean

  /** Knowledge 段 */
  hasInlineKnowledge: boolean
  hasFileKnowledge: boolean

  /** Acceptance / Quality Pledges / Deliverables */
  hasAcceptance: boolean
  acceptanceMust: AcceptanceCriterion[]
  acceptanceShould: AcceptanceCriterion[]
  hasQualityPledges: boolean
  deliverablesWithRubric: Deliverable[]
  hasDeliverables: boolean

  /** ON-DEMAND 触发 */
  isFirstIteration: boolean
  showDeliverableReminder: boolean
  focusedDeliverable?: Deliverable

  /** Critical reminders + Self-check meta */
  criticalRoleConstraints: string[]
  criticalConstraints: string[]
  requiredDeliverableIds: string
  requiredToolNames: string

  /** Self-check 第 6 条 (Required reading) 用 */
  requiredKnowledgePaths: string

  /** Workflow 段渲染辅助 */
  workflowKindLabel: string

  /** Available Skills 段(从 SkillRegistry 渲染好的字符串,空则段省略) */
  skillListing: string
  hasSkillListing: boolean
}

export function buildRuntimeContext(agent: Agent, state: RuntimeIterationState): TemplateContext {
  const profile = agent.profile
  const acceptance = agent.resolvedAcceptance ?? []
  const outcomes = profile.mission?.outcomes ?? []
  const inputs = profile.mission?.inputs ?? []
  const deliverables = profile.delivery?.deliverables ?? []
  const knowledge = profile.method?.knowledge ?? []

  const coreOutcomes = outcomes.filter((o) => (o.priority ?? 'core') === 'core')
  const auxOutcomes = outcomes.filter((o) => o.priority === 'auxiliary')

  const acceptanceMust = acceptance.filter((c) => (c.severity ?? 'must') === 'must')
  const acceptanceShould = acceptance.filter((c) => c.severity === 'should')

  const deliverablesWithRubric = deliverables.filter(
    (d) => Array.isArray(d.rubric) && d.rubric.length > 0,
  )

  const isFirstIteration = state.iterationNumber === 0
  const maxTokens = profile.execution.limits.maxTokens
  const showDeliverableReminder = state.tokensUsed > maxTokens * 0.7 && deliverables.length > 0

  // hasCollaborators: 有 delegationRuntime 且 scope ≠ []
  const hasCollaborators =
    agent.delegationRuntime !== null &&
    (agent.allowedAgentIds === null || agent.allowedAgentIds.length > 0)

  // platform __chat__ 内置 critical role constraint
  const criticalRoleConstraints = buildCriticalRoleConstraints(profile.identity.id, profile)

  // critical reminders: 业务 agent 从 personality + capabilities 提炼;平台 chat 内置
  const criticalConstraints = buildCriticalConstraints(profile.identity.id, profile)

  const requiredDeliverableIds = deliverables
    .filter((d) => d.required !== false)
    .map((d) => d.id)
    .join(', ')

  const requiredToolNames =
    profile.method?.tools
      ?.filter((t) => t.required && !t.disabled)
      .map((t) => t.name)
      .join(', ') ?? ''

  const requiredKnowledgePaths = knowledge
    .filter(
      (k): k is Extract<typeof k, { type: 'file' }> => k.type === 'file' && k.required === true,
    )
    .map((k) => k.path)
    .join(', ')

  const skillListing = renderSkillListing(agent.skillRegistry)

  // enrich knowledge with discriminator booleans (模板 if 用)
  const enrichedKnowledge: EnrichedKnowledge[] = knowledge.map((k) => {
    if (k.type === 'file') return { ...k, isFile: true, isText: false, isUrl: false }
    if (k.type === 'text') return { ...k, isFile: false, isText: true, isUrl: false }
    return { ...k, isFile: false, isText: false, isUrl: true }
  })

  // enrich workflow steps (kind discriminator + use summary)
  const wf = profile.method?.workflow
  const enrichedWorkflow: EnrichedWorkflow | undefined = wf
    ? {
        ...wf,
        steps: wf.steps.map(enrichWorkflowStep),
      }
    : undefined

  const enrichedMethod: EnrichedMethod = {
    ...profile.method,
    knowledge: enrichedKnowledge,
    workflow: enrichedWorkflow,
  }

  const workflowKindLabel =
    wf?.kind === 'dag'
      ? 'partial-order DAG'
      : wf?.kind === 'reactive'
        ? 'reactive — no fixed order'
        : 'sequence — strictly ordered'

  return {
    identity: profile.identity,
    mission: profile.mission,
    method: enrichedMethod,
    delivery: profile.delivery,

    hasMissionOutcomes: outcomes.length > 0,
    hasCoreOutcomes: coreOutcomes.length > 0,
    hasAuxOutcomes: auxOutcomes.length > 0,
    coreOutcomes,
    auxOutcomes,

    hasCollaborators,

    hasInputs: inputs.length > 0,
    inputs,

    hasScope:
      Array.isArray(profile.mission?.scope?.in) &&
      Array.isArray(profile.mission?.scope?.out) &&
      profile.mission.scope.in.length + profile.mission.scope.out.length > 0,

    hasInlineKnowledge: knowledge.some((k) => k.type === 'text'),
    hasFileKnowledge: knowledge.some((k) => k.type === 'file'),

    hasAcceptance: acceptance.length > 0,
    acceptanceMust,
    acceptanceShould,
    hasQualityPledges: deliverablesWithRubric.length > 0,
    deliverablesWithRubric,
    hasDeliverables: deliverables.length > 0,

    isFirstIteration,
    showDeliverableReminder,
    focusedDeliverable: deliverables[0],

    criticalRoleConstraints,
    criticalConstraints,
    requiredDeliverableIds,
    requiredToolNames,
    requiredKnowledgePaths,

    workflowKindLabel,

    skillListing,
    hasSkillListing: skillListing.length > 0,
  }
}

function enrichWorkflowStep(s: WorkflowStep): EnrichedWorkflowStep {
  const kind = s.kind ?? 'task'
  const useParts: string[] = []
  // v8: step.use.* 是唯一来源
  const tools = s.use?.tools ?? []
  if (tools.length > 0) useParts.push(`tools[${tools.join(',')}]`)
  if (s.use?.skills && s.use.skills.length > 0) useParts.push(`skills[${s.use.skills.join(',')}]`)
  if (s.use?.mcpServers && s.use.mcpServers.length > 0)
    useParts.push(`mcp[${s.use.mcpServers.join(',')}]`)
  if (s.use?.cli && s.use.cli.length > 0) useParts.push(`cli[${s.use.cli.join(',')}]`)
  return {
    ...s,
    isWaitForApproval: kind === 'wait_for_user_approval',
    isBranch: kind === 'branch',
    isLoop: kind === 'loop',
    useSummary: useParts.join(' · '),
  }
}

const MAX_SKILL_DESCRIPTION_CHARS = 1536

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function renderSkillListing(skillRegistry: {
  isEmpty: () => boolean
  listAll: () => Array<{ metadata: { name: string; description: string; when_to_use?: string } }>
}): string {
  if (skillRegistry.isEmpty()) return ''
  const skills = skillRegistry.listAll()
  if (skills.length === 0) return ''

  const listing = skills
    .map((s) => {
      const desc = truncate(s.metadata.description, MAX_SKILL_DESCRIPTION_CHARS)
      const whenLine = s.metadata.when_to_use
        ? `\n  When to use: ${truncate(s.metadata.when_to_use, MAX_SKILL_DESCRIPTION_CHARS)}`
        : ''
      return `- ${s.metadata.name}\n  ${desc}${whenLine}`
    })
    .join('\n\n')

  return `## Available Skills\n\nEach entry is an encapsulated capability. Use via \`skill\` tool (see Task Routing). The "When to use" line lists trigger phrases and example requests — match the user's input against these to pick a skill.\n\n${listing}`
}

function buildCriticalRoleConstraints(agentId: string, _profile: unknown): string[] {
  if (agentId === '__chat__') {
    return [
      'You may delegate sub-tasks via delegate_agent when specialized agents fit better than direct work.',
    ]
  }
  // 其它 agent 默认不在头部加额外约束
  return []
}

function buildCriticalConstraints(
  agentId: string,
  profile: { identity: AgentIdentity; method: AgentMethod },
): string[] {
  if (agentId === '__chat__') {
    return [
      "Don't make changes the user didn't request.",
      'Always confirm before destructive actions.',
      'Be concise; output structured information when it helps.',
    ]
  }
  // 业务 / 其它平台 agent: 从 personality 提取一条作为提醒
  const reminders: string[] = []
  if (profile.method.personality) {
    reminders.push(profile.method.personality)
  }
  return reminders
}
