// src/main/agent/preview.ts — 业务层：Agent profile 预览
//
// IPC `agents:preview` 调用入口。
// 输入: profile (any object) → 输出: PreviewResult (供 UI 直接展示)。
//
// 不影响生产 agent: 内部用临时 Agent 实例计算 prompt + tools + dependency。
//
// 允许依赖: agent/*、prompt/*、shared/*
// 禁止依赖: ipc/*

import type { AgentProfile, AcceptanceCriterion, ValidatorIssue } from '@shared/types/agent'
import { validateProfile } from './validator'
import type { ValidatorContext } from './validator'
import { Agent } from './agent'
import type { BuiltinToolRegistry } from './builtin-registry'
import type { McpToolSource } from './agent-toolset'
import { SkillRegistry } from '../skills/registry'
import { render } from '../prompt/render'
import { naturalize, schemaToBullets } from '../prompt/naturalize'
import { buildRuntimeContext, type TemplateContext } from '../prompt/runtime-context'
import { loadAgentSystemPromptTemplate } from '../prompt/template-loader'

export interface PreviewToolInfo {
  name: string
  description: string
  inputSchema: unknown
  source: 'builtin' | 'mcp' | 'agent-private'
}

export interface PreviewResult {
  renderedPrompt: {
    persistent: string
    onDemandSamples: {
      firstIteration: string
      midIteration: string
      lastIteration: string
    }
  }
  enabledTools: PreviewToolInfo[]
  disabledTools: string[]
  resolvedAcceptance: AcceptanceCriterion[]
  visualizations: {
    workflowDag?: { nodes: unknown[]; edges: Array<[string, string]> }
    outcomeTree: Array<{ outcome: unknown; verifyBy: AcceptanceCriterion[] }>
    acceptanceList: {
      must: Array<{ criterion: AcceptanceCriterion; naturalized: string }>
      should: Array<{ criterion: AcceptanceCriterion; naturalized: string }>
    }
  }
  estimates: {
    promptTokens: number
    toolsCount: number
    knowledgeFilesCount: number
    knowledgeTokenEstimate: number
  }
  validatorIssues: ValidatorIssue[]
}

export interface PreviewDeps {
  builtinRegistry: BuiltinToolRegistry
  mcpRegistry: McpToolSource | null
  knownToolNames?: Set<string>
  knownModelIds?: Set<string>
}

const helpers = {
  joinNaturalize: (criteria: unknown) => {
    if (!Array.isArray(criteria)) return ''
    return criteria.map((c) => naturalize(c as Parameters<typeof naturalize>[0])).join(' AND ')
  },
  naturalize: (criterion: unknown) => {
    if (!criterion || typeof criterion !== 'object') return ''
    return naturalize(criterion as Parameters<typeof naturalize>[0])
  },
  joinBackticks: (arr: unknown, sep: unknown = ' · ') => {
    if (!Array.isArray(arr)) return ''
    const s = typeof sep === 'string' ? sep : ' · '
    return arr.map((x) => '`' + String(x) + '`').join(s)
  },
  joinComma: (arr: unknown) => {
    if (!Array.isArray(arr)) return ''
    return arr.map(String).join(', ')
  },
  schemaToBullets: (schema: unknown) => schemaToBullets(schema),
}

// 模板加载统一走 template-loader (loadAgentSystemPromptTemplate)

export async function previewAgent(
  profileInput: unknown,
  deps: PreviewDeps,
): Promise<PreviewResult> {
  // 1. validate (尽力,即使非法也尝试渲染)
  const validatorCtx: ValidatorContext = {
    knownToolNames: deps.knownToolNames,
    knownModelIds: deps.knownModelIds,
  }
  const validation = validateProfile(profileInput, validatorCtx)
  const validatorIssues: ValidatorIssue[] = validation.valid
    ? validation.warnings
    : [...validation.errors, ...validation.warnings]

  const profile = (
    validation.valid ? validation.profile : (profileInput as AgentProfile)
  ) as AgentProfile

  // 2. 临时 Agent 实例 (不注册到 manager)
  const agent = new Agent({
    profile,
    source: null,
    builtinRegistry: deps.builtinRegistry,
    mcpRegistry: deps.mcpRegistry,
    skillRegistry: SkillRegistry.fromDir(null),
    delegationRuntime: undefined, // preview 不需要委托能力
  })

  // 3. 渲染 3 套 prompt 状态
  const template = loadAgentSystemPromptTemplate()
  const maxTokens = profile.execution?.limits?.maxTokens ?? 100000
  // render 接受通用 Record<string, unknown>;TemplateContext 强转是签名兼容必需(编码指南 #4)。
  const renderTpl = (ctx: TemplateContext): string =>
    render(template, ctx as unknown as Record<string, unknown>, helpers)
  const samples = {
    firstIteration: renderTpl(buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })),
    midIteration: renderTpl(
      buildRuntimeContext(agent, { iterationNumber: 5, tokensUsed: maxTokens * 0.4 }),
    ),
    lastIteration: renderTpl(
      buildRuntimeContext(agent, { iterationNumber: 25, tokensUsed: maxTokens * 0.85 }),
    ),
  }

  // 4. 已启用 / 禁用工具
  const builtinNames = agent.toolRegistry.listBuiltinTools().map((t) => t.name)
  const enabledTools: PreviewToolInfo[] = agent.toolRegistry.listBuiltinTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters as unknown,
    source: builtinNames.includes(t.name) ? 'builtin' : 'agent-private',
  }))
  const disabledTools = (profile.method?.tools ?? []).filter((t) => t.disabled).map((t) => t.name)

  // 5. 可视化数据
  const wf = profile.method?.workflow
  const workflowDag = wf
    ? {
        nodes: wf.steps,
        edges: wf.steps.flatMap<[string, string]>((s) =>
          (s.requires ?? []).map<[string, string]>((r) => [r, s.id]),
        ),
      }
    : undefined
  const outcomeTree = (profile.mission?.outcomes ?? []).map((o) => ({
    outcome: o,
    verifyBy: o.verifyBy,
  }))
  const must = agent.resolvedAcceptance
    .filter((c) => (c.severity ?? 'must') === 'must')
    .map((c) => ({ criterion: c, naturalized: naturalize(c) }))
  const should = agent.resolvedAcceptance
    .filter((c) => c.severity === 'should')
    .map((c) => ({ criterion: c, naturalized: naturalize(c) }))

  // 6. 估算
  const knowledgeFiles = (profile.method?.knowledge ?? []).filter((k) => k.type === 'file')
  const knowledgeTokenEstimate = (profile.method?.knowledge ?? [])
    .filter((k): k is Extract<typeof k, { type: 'text' }> => k.type === 'text')
    .reduce((s, k) => s + Math.ceil(k.content.length / 3), 0)

  return {
    renderedPrompt: {
      persistent: samples.firstIteration,
      onDemandSamples: samples,
    },
    enabledTools,
    disabledTools,
    resolvedAcceptance: agent.resolvedAcceptance,
    visualizations: {
      workflowDag,
      outcomeTree,
      acceptanceList: { must, should },
    },
    estimates: {
      promptTokens: Math.ceil(samples.firstIteration.length / 3),
      toolsCount: enabledTools.length,
      knowledgeFilesCount: knowledgeFiles.length,
      knowledgeTokenEstimate,
    },
    validatorIssues,
  }
}
