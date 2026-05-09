// src/main/agent/validator.ts — 业务层：AgentProfile schema 1.0 校验
//
// v8: acceptance 统一权威源是 mission.outcomes[].verifyBy。delivery.acceptance 已删。
//
// 18 条强校验规则。错误一次性收集后返回，不短路。
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*、repos/*

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { valid as semverValid } from 'semver'
import type {
  AgentProfile,
  Deliverable,
  ValidateProfileResult,
  ValidatorIssue,
  WorkflowStep,
  AcceptanceCriterion,
  KnowledgeRef,
} from '@shared/types/agent'
import { BUILTIN_TOOL_NAMES } from '@shared/types/agent'
import { extractEntities } from './entity-extractor'

export interface ValidatorContext {
  /** 已注册工具名集合(builtin + mcp 工具)。不传时跳过 rule 7 */
  knownToolNames?: Set<string>
  /** 已注册模型 id 集合。不传时跳过 rule 12 */
  knownModelIds?: Set<string>
  /** agent 根目录,用于解析 knowledge.path 相对路径。不传时跳过 rule 8 file 检查 */
  agentRoot?: string
}

const PLATFORM_ID_RE = /^__[a-z0-9_-]+__$/

/**
 * 主入口。返回收集后的 errors+warnings。
 * - errors.length === 0 → valid: true
 */
export function validateProfile(json: unknown, ctx: ValidatorContext = {}): ValidateProfileResult {
  const errors: ValidatorIssue[] = []
  const warnings: ValidatorIssue[] = []

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return {
      valid: false,
      errors: [
        { severity: 'error', rule: 0, path: '', message: 'input must be a non-null object' },
      ],
      warnings: [],
    }
  }

  const obj = json as Record<string, unknown>

  // RULE 1: schemaVersion === '1.0'
  if (obj.schemaVersion !== '1.0') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'schemaVersion',
      message: `must be "1.0", got ${JSON.stringify(obj.schemaVersion)}`,
    })
    // schemaVersion 错就返回 — 后续校验依赖结构
    return { valid: false, errors, warnings }
  }

  // identity 校验（先,影响 rule 14 平台判定）
  const identity = obj.identity as Record<string, unknown> | undefined
  validateIdentity(identity, errors)

  const isPlatform = identity && typeof identity.id === 'string' && PLATFORM_ID_RE.test(identity.id)

  // mission / method / delivery / execution 各段校验
  validateMission(obj.mission, isPlatform, errors)
  validateMethod(obj.method, errors, ctx)
  validateDelivery(obj.delivery, isPlatform, errors)
  validateExecution(obj.execution, errors)
  validatePreferences(obj.preferences, errors, ctx)

  // 结构性错误存在时不进一步做引用 / DAG 校验（避免误报）
  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  const profile = obj as unknown as AgentProfile

  // RULE 5/6/9: workflow DAG + produces 收口 + inputs 引用
  validateWorkflowDag(profile, errors)

  // RULE 4: 引用完整性（acceptance / verifyBy 引用 deliverableId/toolName）
  validateReferences(profile, errors, ctx)

  // RULE 8 file: knowledge.type='file' path 必须存在
  validateKnowledgePaths(profile, errors, warnings, ctx)

  // RULE 10: deliverable.extractFrom 缺省补默认
  applyExtractFromDefaults(profile)

  // RULE 13: capabilities ↔ outcomes 关键词重叠 (warn)
  validateCapabilityOverlap(profile, warnings)

  // mission.inputs 重复 id 检查
  validateMissionInputs(profile, errors)

  // RULE 16: workflow.steps[].use.* / .tools 必须在 method.* 中声明
  validateWorkflowDependencyClosure(profile, errors)

  // RULE 17: capabilities 反向完整性 (warn)
  validateCapabilityDependencyDeclared(profile, warnings)

  // RULE 19 (D2): identity / mission / scope / knowledge 文本字段不得含具体实体
  // (公司名 / 股票代号 / 文件路径)。会话沉淀的 agent 容易把会话特定锚点固化进 profile,
  // 让所有委托都受历史偏见影响。
  validateNoSpecificEntities(profile, warnings)

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  return { valid: true, profile, warnings }
}

// ─── identity ────────────────────────────────────────────

function validateIdentity(
  identity: Record<string, unknown> | undefined,
  errors: ValidatorIssue[],
): void {
  if (!identity || typeof identity !== 'object') {
    errors.push({ severity: 'error', rule: 1, path: 'identity', message: 'must be an object' })
    return
  }
  if (typeof identity.id !== 'string' || !/^[a-z0-9_-]+$/.test(identity.id)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'identity.id',
      message: 'must match /^[a-z0-9_-]+$/',
    })
  }
  if (typeof identity.name !== 'string' || identity.name.trim() === '') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'identity.name',
      message: 'must be a non-empty string',
    })
  }
  if (typeof identity.description !== 'string' || identity.description.trim() === '') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'identity.description',
      message: 'must be a non-empty string',
    })
  }
  if (typeof identity.version !== 'string' || !semverValid(identity.version)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'identity.version',
      message: 'must be a valid semver',
    })
  }
  if (
    identity.minAppVersion !== undefined &&
    identity.minAppVersion !== null &&
    (typeof identity.minAppVersion !== 'string' || !semverValid(identity.minAppVersion))
  ) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'identity.minAppVersion',
      message: 'must be a valid semver',
    })
  }
}

// ─── mission ─────────────────────────────────────────────

function validateMission(
  mission: unknown,
  isPlatform: boolean | undefined,
  errors: ValidatorIssue[],
): void {
  if (!mission || typeof mission !== 'object' || Array.isArray(mission)) {
    errors.push({ severity: 'error', rule: 1, path: 'mission', message: 'must be an object' })
    return
  }
  const m = mission as Record<string, unknown>
  if (typeof m.objective !== 'string' || m.objective.trim() === '') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'mission.objective',
      message: 'must be a non-empty string',
    })
  }
  if (!Array.isArray(m.outcomes)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'mission.outcomes',
      message: 'must be an array',
    })
    return
  }

  // RULE 14 platform exception: outcomes 允许为空
  if (m.outcomes.length === 0 && !isPlatform) {
    errors.push({
      severity: 'error',
      rule: 14,
      path: 'mission.outcomes',
      message: 'business agent must have ≥1 outcome',
    })
  }

  m.outcomes.forEach((o: unknown, idx: number) => {
    validateOutcome(o, idx, errors)
  })

  // RULE 18: mission.scope (可选;有声明时 in/out 必须为字符串数组)
  if (m.scope !== undefined && m.scope !== null) {
    if (typeof m.scope !== 'object' || Array.isArray(m.scope)) {
      errors.push({
        severity: 'error',
        rule: 18,
        path: 'mission.scope',
        message: 'must be an object with `in` and `out` string arrays',
      })
    } else {
      const sc = m.scope as Record<string, unknown>
      if (!Array.isArray(sc.in) || sc.in.some((x) => typeof x !== 'string' || x.trim() === '')) {
        errors.push({
          severity: 'error',
          rule: 18,
          path: 'mission.scope.in',
          message: 'must be an array of non-empty strings',
        })
      }
      if (!Array.isArray(sc.out) || sc.out.some((x) => typeof x !== 'string' || x.trim() === '')) {
        errors.push({
          severity: 'error',
          rule: 18,
          path: 'mission.scope.out',
          message: 'must be an array of non-empty strings',
        })
      }
    }
  }
}

function validateOutcome(o: unknown, idx: number, errors: ValidatorIssue[]): void {
  const path = `mission.outcomes[${idx}]`
  if (!o || typeof o !== 'object') {
    errors.push({ severity: 'error', rule: 1, path, message: 'must be an object' })
    return
  }
  const oc = o as Record<string, unknown>
  if (typeof oc.id !== 'string' || !/^[a-z0-9_-]+$/.test(oc.id)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.id`,
      message: 'must match /^[a-z0-9_-]+$/',
    })
  }
  if (typeof oc.description !== 'string' || oc.description.trim() === '') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.description`,
      message: 'must be a non-empty string',
    })
  }
  if (oc.priority !== undefined && oc.priority !== 'core' && oc.priority !== 'auxiliary') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.priority`,
      message: 'must be "core" or "auxiliary"',
    })
  }
  if (!Array.isArray(oc.verifyBy) || oc.verifyBy.length === 0) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.verifyBy`,
      message: 'must be a non-empty array',
    })
    return
  }

  // RULE 2: verifyBy 至少一条 severity='must' AND kind ∈ {deterministic, human}
  const hasMustHard = (oc.verifyBy as AcceptanceCriterion[]).some(
    (c) => (c.severity ?? 'must') === 'must' && (c.kind === 'deterministic' || c.kind === 'human'),
  )
  if (!hasMustHard) {
    errors.push({
      severity: 'error',
      rule: 2,
      path: `${path}.verifyBy`,
      message: 'must contain ≥1 criterion with severity="must" and kind in {deterministic, human}',
    })
  }

  ;(oc.verifyBy as AcceptanceCriterion[]).forEach((c, i) => {
    validateAcceptanceCriterion(c, `${path}.verifyBy[${i}]`, errors)
  })
}

function validateAcceptanceCriterion(c: unknown, path: string, errors: ValidatorIssue[]): void {
  if (!c || typeof c !== 'object') {
    errors.push({ severity: 'error', rule: 1, path, message: 'must be an object' })
    return
  }
  const cr = c as Record<string, unknown>
  const validTypes = [
    'deliverable-present',
    'tool-was-used',
    'tool-not-used',
    'tool-not-failed',
    'output-matches',
    'verifier-tool',
    'llm-judge',
    'human-approval',
  ]
  if (typeof cr.type !== 'string' || !validTypes.includes(cr.type)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.type`,
      message: `must be one of: ${validTypes.join(', ')}`,
    })
    return
  }
  if (cr.kind !== 'deterministic' && cr.kind !== 'semantic' && cr.kind !== 'human') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.kind`,
      message: 'must be "deterministic", "semantic", or "human"',
    })
  }

  if (cr.severity !== undefined && cr.severity !== 'must' && cr.severity !== 'should') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: `${path}.severity`,
      message: 'must be "must" or "should"',
    })
  }

  // 各 type 的字段必填检查
  switch (cr.type) {
    case 'deliverable-present':
      if (typeof cr.deliverableId !== 'string') {
        errors.push({
          severity: 'error',
          rule: 1,
          path: `${path}.deliverableId`,
          message: 'must be a string',
        })
      }
      break
    case 'tool-was-used':
    case 'tool-not-used':
    case 'tool-not-failed':
    case 'verifier-tool':
      if (typeof cr.toolName !== 'string') {
        errors.push({
          severity: 'error',
          rule: 1,
          path: `${path}.toolName`,
          message: 'must be a string',
        })
      }
      break
    case 'output-matches':
      if (cr.schema === undefined && cr.pattern === undefined) {
        errors.push({
          severity: 'error',
          rule: 1,
          path,
          message: 'must have schema or pattern',
        })
      }
      break
    case 'llm-judge':
      if (typeof cr.judgePrompt !== 'string') {
        errors.push({
          severity: 'error',
          rule: 1,
          path: `${path}.judgePrompt`,
          message: 'must be a string',
        })
      }
      break
    case 'human-approval':
      if (typeof cr.approverRef !== 'string') {
        errors.push({
          severity: 'error',
          rule: 1,
          path: `${path}.approverRef`,
          message: 'must be a string',
        })
      }
      break
  }
}

function validateMissionInputs(profile: AgentProfile, errors: ValidatorIssue[]): void {
  const inputs = profile.mission.inputs
  if (!inputs || inputs.length === 0) return
  const seen = new Set<string>()
  inputs.forEach((inp, i) => {
    if (seen.has(inp.id)) {
      errors.push({
        severity: 'error',
        rule: 4,
        path: `mission.inputs[${i}].id`,
        message: `duplicate input id "${inp.id}"`,
      })
    }
    seen.add(inp.id)
  })
}

// ─── method ──────────────────────────────────────────────

function validateMethod(method: unknown, errors: ValidatorIssue[], _ctx: ValidatorContext): void {
  if (!method || typeof method !== 'object' || Array.isArray(method)) {
    errors.push({ severity: 'error', rule: 1, path: 'method', message: 'must be an object' })
    return
  }
  const m = method as Record<string, unknown>
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'method.capabilities',
      message: 'must be a non-empty array',
    })
  }

  // RULE 7: v8.1 — tools[].name 必须是 7 个内置工具之一
  // 元工具 (search_tool/skill/delegate_agent) 不能写在 method.tools,
  // 由 method.mcpServers/skills/collaboration 派生。
  if (Array.isArray(m.tools)) {
    m.tools.forEach((t, i) => {
      if (t && typeof t === 'object') {
        const tn = (t as Record<string, unknown>).name
        if (typeof tn !== 'string') {
          errors.push({
            severity: 'error',
            rule: 1,
            path: `method.tools[${i}].name`,
            message: 'must be a string',
          })
        } else if (!(BUILTIN_TOOL_NAMES as readonly string[]).includes(tn)) {
          errors.push({
            severity: 'error',
            rule: 7,
            path: `method.tools[${i}].name`,
            message:
              `must be one of: ${BUILTIN_TOOL_NAMES.join(', ')}. ` +
              `Meta-tools (search_tool/skill/delegate_agent) are derived from method.mcpServers/skills/collaboration, not declared here.`,
          })
        }
      }
    })
  }

  // method.workflow 在 validateWorkflowDag 单独校验（rule 5/6/9）
}

// ─── delivery ────────────────────────────────────────────

function validateDelivery(
  delivery: unknown,
  isPlatform: boolean | undefined,
  errors: ValidatorIssue[],
): void {
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
    errors.push({ severity: 'error', rule: 1, path: 'delivery', message: 'must be an object' })
    return
  }
  const d = delivery as Record<string, unknown>
  if (!Array.isArray(d.deliverables)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'delivery.deliverables',
      message: 'must be an array',
    })
    return
  }

  // RULE 14 platform exception (acceptance 已删,只剩 deliverables 检查)
  if (!isPlatform) {
    if (d.deliverables.length === 0) {
      errors.push({
        severity: 'error',
        rule: 14,
        path: 'delivery.deliverables',
        message: 'business agent must have ≥1 deliverable',
      })
    }
  }

  // RULE 3: deliverable 必须有 schema 或 mustContain
  d.deliverables.forEach((deliv, i) => {
    if (deliv && typeof deliv === 'object') {
      const dv = deliv as Record<string, unknown>
      if (typeof dv.id !== 'string' || !/^[a-z0-9_-]+$/.test(dv.id)) {
        errors.push({
          severity: 'error',
          rule: 1,
          path: `delivery.deliverables[${i}].id`,
          message: 'must match /^[a-z0-9_-]+$/',
        })
      }
      if (
        typeof dv.format !== 'string' ||
        !['markdown', 'json', 'structured', 'text'].includes(dv.format)
      ) {
        errors.push({
          severity: 'error',
          rule: 1,
          path: `delivery.deliverables[${i}].format`,
          message: 'must be one of: markdown, json, structured, text',
        })
      }

      const hasSchema = dv.schema !== undefined && dv.schema !== null
      const hasMustContain = Array.isArray(dv.mustContain) && dv.mustContain.length > 0
      if (!hasSchema && !hasMustContain) {
        errors.push({
          severity: 'error',
          rule: 3,
          path: `delivery.deliverables[${i}]`,
          message: 'must have either "schema" or non-empty "mustContain"',
        })
      }
    }
  })
}

// ─── execution ───────────────────────────────────────────

function validateExecution(execution: unknown, errors: ValidatorIssue[]): void {
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'execution',
      message: 'must be an object',
    })
    return
  }
  const e = execution as Record<string, unknown>

  const limits = e.limits as Record<string, unknown> | undefined
  if (!limits || typeof limits !== 'object') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'execution.limits',
      message: 'must be an object',
    })
  } else {
    if (typeof limits.maxSteps !== 'number' || limits.maxSteps < 1) {
      errors.push({
        severity: 'error',
        rule: 1,
        path: 'execution.limits.maxSteps',
        message: 'must be a positive integer',
      })
    }
    if (typeof limits.maxTokens !== 'number' || limits.maxTokens < 1) {
      errors.push({
        severity: 'error',
        rule: 1,
        path: 'execution.limits.maxTokens',
        message: 'must be a positive integer',
      })
    }
  }

  const policy = e.retryPolicy as Record<string, unknown> | undefined
  if (!policy || typeof policy !== 'object') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'execution.retryPolicy',
      message: 'must be an object',
    })
    return
  }
  if (typeof policy.maxAttempts !== 'number' || policy.maxAttempts < 1) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'execution.retryPolicy.maxAttempts',
      message: 'must be a positive integer',
    })
  }
  const validOnMust = ['retry-then-mark', 'retry-then-escalate', 'abort']
  if (typeof policy.onMustFail !== 'string' || !validOnMust.includes(policy.onMustFail)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'execution.retryPolicy.onMustFail',
      message: `must be one of: ${validOnMust.join(', ')}`,
    })
  }
  const validOnShould = ['mark-only', 'retry-once']
  if (typeof policy.onShouldFail !== 'string' || !validOnShould.includes(policy.onShouldFail)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'execution.retryPolicy.onShouldFail',
      message: `must be one of: ${validOnShould.join(', ')}`,
    })
  }

  // RULE 11: retry-then-escalate 需要 escalateTo
  if (
    policy.onMustFail === 'retry-then-escalate' &&
    (!policy.escalateTo || typeof policy.escalateTo !== 'object')
  ) {
    errors.push({
      severity: 'error',
      rule: 11,
      path: 'execution.retryPolicy.escalateTo',
      message: 'required when onMustFail = "retry-then-escalate"',
    })
  }
}

// ─── preferences ─────────────────────────────────────────

function validatePreferences(
  preferences: unknown,
  errors: ValidatorIssue[],
  ctx: ValidatorContext,
): void {
  if (preferences === undefined || preferences === null) return
  if (typeof preferences !== 'object' || Array.isArray(preferences)) {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'preferences',
      message: 'must be an object',
    })
    return
  }
  const p = preferences as Record<string, unknown>

  // RULE 12: modelId 必须是已注册模型
  if (
    p.modelId !== undefined &&
    p.modelId !== null &&
    typeof p.modelId === 'string' &&
    ctx.knownModelIds &&
    !ctx.knownModelIds.has(p.modelId)
  ) {
    errors.push({
      severity: 'error',
      rule: 12,
      path: 'preferences.modelId',
      message: `unknown model "${p.modelId}"`,
    })
  }
}

// ─── workflow DAG (rule 5 + 6 + 9) ────────────────────────

function validateWorkflowDag(profile: AgentProfile, errors: ValidatorIssue[]): void {
  const wf = profile.method.workflow
  if (!wf) return
  if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
    errors.push({
      severity: 'error',
      rule: 5,
      path: 'method.workflow.steps',
      message: 'must be a non-empty array',
    })
    return
  }

  const stepIds = new Set<string>()
  wf.steps.forEach((s: WorkflowStep, i) => {
    if (typeof s.id !== 'string') {
      errors.push({
        severity: 'error',
        rule: 5,
        path: `method.workflow.steps[${i}].id`,
        message: 'must be a string',
      })
      return
    }
    if (stepIds.has(s.id)) {
      errors.push({
        severity: 'error',
        rule: 5,
        path: `method.workflow.steps[${i}].id`,
        message: `duplicate step id "${s.id}"`,
      })
    }
    stepIds.add(s.id)
  })

  // RULE 5: requires 引用必须存在 + DAG 无环
  const requiresMap = new Map<string, string[]>()
  wf.steps.forEach((s: WorkflowStep, i) => {
    requiresMap.set(s.id, s.requires ?? [])
    ;(s.requires ?? []).forEach((r) => {
      if (!stepIds.has(r)) {
        errors.push({
          severity: 'error',
          rule: 5,
          path: `method.workflow.steps[${i}].requires`,
          message: `references unknown step "${r}"`,
        })
      }
    })
  })
  if (hasCycle(requiresMap)) {
    errors.push({
      severity: 'error',
      rule: 5,
      path: 'method.workflow.steps',
      message: 'workflow has a cycle',
    })
  }

  // RULE 6: produces 必须指向 deliverable.id 或下游消费的 stepOutput
  const deliverableIds = new Set(profile.delivery.deliverables.map((d) => d.id))
  const consumedSet = new Set<string>()
  wf.steps.forEach((s) => {
    ;(s.inputs ?? []).forEach((inp) => {
      if (inp !== 'user-input') consumedSet.add(inp)
    })
  })
  wf.steps.forEach((s: WorkflowStep, i) => {
    if (s.produces) {
      if (!deliverableIds.has(s.produces) && !consumedSet.has(s.produces)) {
        errors.push({
          severity: 'error',
          rule: 6,
          path: `method.workflow.steps[${i}].produces`,
          message: `step output "${s.produces}" is orphan (not a deliverable id and not consumed downstream)`,
        })
      }
    }
  })

  // RULE 9: inputs 引用必须指向上游 produces 或 'user-input' 哨兵
  const producedSet = new Set<string>()
  wf.steps.forEach((s) => {
    if (s.produces) producedSet.add(s.produces)
  })
  wf.steps.forEach((s: WorkflowStep, i) => {
    ;(s.inputs ?? []).forEach((inp) => {
      if (inp !== 'user-input' && !producedSet.has(inp)) {
        errors.push({
          severity: 'error',
          rule: 9,
          path: `method.workflow.steps[${i}].inputs`,
          message: `input "${inp}" has no producer`,
        })
      }
    })
  })
}

function hasCycle(graph: Map<string, string[]>): boolean {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map<string, number>()
  for (const k of graph.keys()) color.set(k, WHITE)

  function dfs(node: string): boolean {
    color.set(node, GRAY)
    const reqs = graph.get(node) ?? []
    for (const r of reqs) {
      const c = color.get(r)
      if (c === GRAY) return true
      if (c === WHITE && dfs(r)) return true
    }
    color.set(node, BLACK)
    return false
  }

  for (const k of graph.keys()) {
    if (color.get(k) === WHITE && dfs(k)) return true
  }
  return false
}

// ─── 引用完整性 (rule 4) ─────────────────────────────────

function validateReferences(
  profile: AgentProfile,
  errors: ValidatorIssue[],
  ctx: ValidatorContext,
): void {
  const deliverableIds = new Set(profile.delivery.deliverables.map((d) => d.id))
  const declaredToolNames = new Set(profile.method.tools?.map((t) => t.name) ?? [])
  const allToolNames = new Set([...declaredToolNames, ...(ctx.knownToolNames ?? [])])

  // 检查所有 acceptance criterion 的引用 (源已统一为 outcomes.verifyBy)
  const allCriteria: Array<{ criterion: AcceptanceCriterion; path: string }> = []
  profile.mission.outcomes.forEach((o, i) =>
    o.verifyBy.forEach((c, j) =>
      allCriteria.push({ criterion: c, path: `mission.outcomes[${i}].verifyBy[${j}]` }),
    ),
  )

  for (const { criterion, path } of allCriteria) {
    if (criterion.type === 'deliverable-present') {
      if (!deliverableIds.has(criterion.deliverableId)) {
        errors.push({
          severity: 'error',
          rule: 4,
          path: `${path}.deliverableId`,
          message: `deliverableId "${criterion.deliverableId}" not found`,
        })
      }
    }
    if (
      (criterion.type === 'tool-was-used' ||
        criterion.type === 'tool-not-used' ||
        criterion.type === 'tool-not-failed' ||
        criterion.type === 'verifier-tool') &&
      ctx.knownToolNames !== undefined
    ) {
      if (!allToolNames.has(criterion.toolName)) {
        errors.push({
          severity: 'error',
          rule: 4,
          path: `${path}.toolName`,
          message: `toolName "${criterion.toolName}" not found in known tools`,
        })
      }
    }
  }
}

// ─── knowledge.path 检查 (rule 8) ─────────────────────────

function validateKnowledgePaths(
  profile: AgentProfile,
  errors: ValidatorIssue[],
  _warnings: ValidatorIssue[], // 预留:url HEAD 校验在 P1 走 warn 通道
  ctx: ValidatorContext,
): void {
  const items = profile.method.knowledge ?? []
  items.forEach((k: KnowledgeRef, i) => {
    if (k.type === 'file') {
      if (typeof k.path !== 'string' || k.path.trim() === '') {
        errors.push({
          severity: 'error',
          rule: 8,
          path: `method.knowledge[${i}].path`,
          message: 'must be a non-empty string',
        })
        return
      }
      if (ctx.agentRoot) {
        const full = isAbsolute(k.path) ? k.path : resolve(ctx.agentRoot, k.path)
        if (!existsSync(full)) {
          errors.push({
            severity: 'error',
            rule: 8,
            path: `method.knowledge[${i}].path`,
            message: `file does not exist: ${k.path}`,
          })
        }
      }
    } else if (k.type === 'url') {
      // url HEAD 校验在 P1（可异步）。P0 仅检查 url 字段非空。
      if (typeof k.url !== 'string' || k.url.trim() === '') {
        errors.push({
          severity: 'error',
          rule: 8,
          path: `method.knowledge[${i}].url`,
          message: 'must be a non-empty string',
        })
      }
    }
    // text 类型不需要存在性校验
  })
}

// ─── extractFrom 默认值 (rule 10) ────────────────────────

function applyExtractFromDefaults(profile: AgentProfile): void {
  profile.delivery.deliverables.forEach((d: Deliverable) => {
    if (!d.extractFrom) {
      d.extractFrom =
        d.format === 'json'
          ? { type: 'json-fenced-block', firstOrLast: 'last' }
          : { type: 'last-message' }
    }
  })
}

// ─── capability ↔ outcome 重叠 (rule 13 warn) ────────────

function validateCapabilityOverlap(profile: AgentProfile, warnings: ValidatorIssue[]): void {
  const outcomes = profile.mission.outcomes ?? []
  if (outcomes.length === 0) return // 平台 agent 跳过

  const outcomeWords = new Set<string>()
  for (const o of outcomes) {
    for (const w of tokenize(o.description)) outcomeWords.add(w)
    for (const w of tokenize(o.id)) outcomeWords.add(w)
  }

  ;(profile.method.capabilities ?? []).forEach((cap, i) => {
    const capWords = tokenize(cap)
    const overlap = capWords.filter((w) => outcomeWords.has(w))
    if (overlap.length === 0) {
      warnings.push({
        severity: 'warn',
        rule: 13,
        path: `method.capabilities[${i}]`,
        message: `no keyword overlap with any outcome — capability may be drift`,
      })
    }
  })
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'and',
  'or',
  'of',
  'in',
  'on',
  'to',
  'for',
  'with',
  'by',
  'at',
  'as',
  'from',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'we',
  'they',
  'it',
  'will',
  'should',
  'must',
  'can',
  'may',
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

// ─── workflow 依赖闭包 (rule 16) ─────────────────────────────
//
// 每个 workflow step 引用的依赖（step.use.*）必须在 method.* 中声明。
// 这条规则是 "完成性闸门" 反例的反面：v7 export agent 流程下，LLM 在 workflow.steps 中
// 列出依赖却忘了在 method.* 中声明 → 运行时装配阶段不暴露 → LLM 卡死。

function validateWorkflowDependencyClosure(profile: AgentProfile, errors: ValidatorIssue[]): void {
  const wf = profile.method.workflow
  if (!wf || !Array.isArray(wf.steps) || wf.steps.length === 0) return

  const declaredTools = new Set<string>((profile.method.tools ?? []).map((t) => t.name))
  const declaredSkills = new Set<string>((profile.method.skills ?? []).map((s) => s.name))
  const declaredMcps = new Set<string>((profile.method.mcpServers ?? []).map((s) => s.name))
  const declaredCli = new Set<string>((profile.method.cli ?? []).map((c) => c.command))

  wf.steps.forEach((s: WorkflowStep, i) => {
    const path = `method.workflow.steps[${i}]`

    // step.use.{tools,skills,mcpServers,cli} 是唯一的依赖来源
    if (s.use) {
      ;(s.use.tools ?? []).forEach((tn, j) => {
        if (!declaredTools.has(tn)) {
          errors.push({
            severity: 'error',
            rule: 16,
            path: `${path}.use.tools[${j}]`,
            message: `step uses tool "${tn}" but it is not declared in method.tools`,
          })
        }
      })
      ;(s.use.skills ?? []).forEach((sn, j) => {
        if (!declaredSkills.has(sn)) {
          errors.push({
            severity: 'error',
            rule: 16,
            path: `${path}.use.skills[${j}]`,
            message: `step uses skill "${sn}" but it is not declared in method.skills`,
          })
        }
      })
      ;(s.use.mcpServers ?? []).forEach((mn, j) => {
        if (!declaredMcps.has(mn)) {
          errors.push({
            severity: 'error',
            rule: 16,
            path: `${path}.use.mcpServers[${j}]`,
            message: `step uses MCP server "${mn}" but it is not declared in method.mcpServers`,
          })
        }
      })
      ;(s.use.cli ?? []).forEach((cn, j) => {
        if (!declaredCli.has(cn)) {
          errors.push({
            severity: 'error',
            rule: 16,
            path: `${path}.use.cli[${j}]`,
            message: `step uses CLI "${cn}" but it is not declared in method.cli`,
          })
        }
      })
    }

    // kind='branch' 必填 branchOn / kind='loop' 必填 loopWhile
    if (s.kind === 'branch' && (typeof s.branchOn !== 'string' || s.branchOn.trim() === '')) {
      errors.push({
        severity: 'error',
        rule: 16,
        path: `${path}.branchOn`,
        message: 'kind="branch" requires non-empty branchOn',
      })
    }
    if (s.kind === 'loop' && (typeof s.loopWhile !== 'string' || s.loopWhile.trim() === '')) {
      errors.push({
        severity: 'error',
        rule: 16,
        path: `${path}.loopWhile`,
        message: 'kind="loop" requires non-empty loopWhile',
      })
    }
  })
}

// ─── capabilities 反向完整性 (rule 17 warn) ──────────────────
//
// capabilities 文本里被名字提到的 skill / cli / mcp 应该在 method.* 中声明，否则
// 运行时 prompt 暗示 LLM 该用某 skill，但工具表里没有 → 卡死。
//
// 渲染端 DraftReviewModal 也做了类似 detectDependencyMismatch；这里在 validator 层面
// 给 warn，让保存路径也看到一次。命中库通过简单关键词匹配 — 命中即提示，不强制 fail。

const SKILL_TOKEN_RE =
  /\b(lark-[a-z]+|yummy|klook-[a-z-]+|java-ut-[a-z-]+|go-ut-[a-z-]+|web-ut-[a-z-]+|flutter-ut-[a-z-]+|update-config|simplify|loop|schedule|claude-api|init|review|security-review|frontend-design|fewer-permission-prompts|keybindings-help|statusline-setup)\b/g

const CLI_TOKEN_RE =
  /\b(git|npm|yarn|pnpm|docker|kubectl|gh|curl|wget|go|cargo|python3?|pip3?|node|bun|deno|aws|gcloud|terraform|ansible|make|sed|awk|jq|ffmpeg|psql|mysql|redis-cli)\b/g

// ─── 实体污染检测 (rule 19, D2) ─────────────────────────────────
//
// 设计原则:
//   - warn 而不是 error。crystallizer 偶尔会留 "百度" 等通用品牌做示例,error 太严
//   - 仅扫描 prompt 渲染面 (identity / mission / scope / knowledge.description),
//     workflow / acceptance 内的 tool/path 引用是合法实体,不在此检查
//   - 通用拉丁缩写 (BIDU/AAPL 这类 ticker) 也算具体实体 — 实践中真实的 agent
//     描述应该用通用语言 ("中国互联网股票" 而不是 "BIDU 等公司")

function validateNoSpecificEntities(profile: AgentProfile, warnings: ValidatorIssue[]): void {
  const checks: Array<{ path: string; text: string }> = [
    { path: 'identity.name', text: profile.identity?.name ?? '' },
    { path: 'identity.description', text: profile.identity?.description ?? '' },
    { path: 'mission.objective', text: profile.mission?.objective ?? '' },
  ]
  ;(profile.mission?.outcomes ?? []).forEach((o, i) => {
    checks.push({ path: `mission.outcomes[${i}].description`, text: o.description ?? '' })
  })
  ;(profile.mission?.scope?.in ?? []).forEach((s, i) => {
    checks.push({ path: `mission.scope.in[${i}]`, text: s })
  })
  ;(profile.mission?.scope?.out ?? []).forEach((s, i) => {
    checks.push({ path: `mission.scope.out[${i}]`, text: s })
  })
  ;(profile.method?.knowledge ?? []).forEach((k, i) => {
    checks.push({ path: `method.knowledge[${i}].description`, text: k.description ?? '' })
    if (k.type === 'text' && (k as { content?: string }).content) {
      checks.push({
        path: `method.knowledge[${i}].content`,
        text: (k as { content: string }).content,
      })
    }
  })
  ;(profile.method?.capabilities ?? []).forEach((cap, i) => {
    checks.push({ path: `method.capabilities[${i}]`, text: cap })
  })

  for (const { path, text } of checks) {
    if (!text) continue
    const entities = extractEntities(text)
    // 仅 flag 高置信度类: ticker / stock-code / path / cn-name >= 4
    const flagged = entities.filter((e) => {
      if (e.category === 'ticker' || e.category === 'stock-code' || e.category === 'path')
        return true
      if (e.category === 'cn-name' && e.text.length >= 4) return true
      return false
    })
    if (flagged.length === 0) continue
    const sample = flagged
      .slice(0, 3)
      .map((e) => e.text)
      .join(', ')
    warnings.push({
      severity: 'warn',
      rule: 19,
      path,
      message:
        `contains specific entities [${sample}${flagged.length > 3 ? ', ...' : ''}] — ` +
        `prompt-rendered fields should use generic language (e.g., "中国互联网股票" not "BIDU/百度"). ` +
        `Specific entities bias all delegations regardless of user intent.`,
    })
  }
}

function validateCapabilityDependencyDeclared(
  profile: AgentProfile,
  warnings: ValidatorIssue[],
): void {
  const caps = (profile.method.capabilities ?? []).filter((c): c is string => typeof c === 'string')
  if (caps.length === 0) return

  const text = caps.join(' ')
  const declaredSkills = new Set((profile.method.skills ?? []).map((s) => s.name))
  const declaredCli = new Set((profile.method.cli ?? []).map((c) => c.command))

  const mentionedSkills = new Set<string>()
  let m: RegExpExecArray | null
  SKILL_TOKEN_RE.lastIndex = 0
  while ((m = SKILL_TOKEN_RE.exec(text)) !== null) mentionedSkills.add(m[1])
  for (const s of mentionedSkills) {
    if (!declaredSkills.has(s)) {
      warnings.push({
        severity: 'warn',
        rule: 17,
        path: 'method.capabilities',
        message: `capability mentions skill "${s}" but it is not declared in method.skills`,
      })
    }
  }

  const mentionedCli = new Set<string>()
  CLI_TOKEN_RE.lastIndex = 0
  while ((m = CLI_TOKEN_RE.exec(text)) !== null) mentionedCli.add(m[1])
  for (const c of mentionedCli) {
    if (!declaredCli.has(c)) {
      warnings.push({
        severity: 'warn',
        rule: 17,
        path: 'method.capabilities',
        message: `capability mentions CLI "${c}" but it is not declared in method.cli`,
      })
    }
  }
}
