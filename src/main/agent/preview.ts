// src/main/agent/preview.ts — 业务层：Agent profile 预览
//
// IPC `agents:preview` 调用入口。
// 输入: profile (any object) → 输出: PreviewResult (供 UI 直接展示)。
//
// 不影响生产 agent: 内部用临时 Agent 实例计算 prompt + tools + dependency。
//
// v2.0 变更: 移除 resolvedAcceptance / visualizations.acceptanceList / outcomeTree。
// 移除 profile.execution.limits (用常量替代)。
// 移除 profile.method.workflow / profile.method.knowledge (已删除)。
// references 替代 knowledge。
//
// 允许依赖: agent/*、prompt/*、shared/*
// 禁止依赖: ipc/*

import type { AgentProfile, ValidatorIssue } from '@shared/types/agent'
import { validateProfile } from './validator'
import type { ValidatorContext } from './validator'
import { Agent } from './agent'
import type { BuiltinToolRegistry } from './builtin-registry'
import type { McpToolSource } from './agent-toolset'
import { SkillRegistry } from '../skills/registry'
import { render } from '../prompt/render'
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
  estimates: {
    promptTokens: number
    toolsCount: number
  }
  validatorIssues: ValidatorIssue[]
}

export interface PreviewDeps {
  builtinRegistry: BuiltinToolRegistry
  mcpRegistry: McpToolSource | null
  knownToolNames?: Set<string>
}

export async function previewAgent(
  profileInput: unknown,
  deps: PreviewDeps,
): Promise<PreviewResult> {
  // 1. validate (尽力,即使非法也尝试渲染)
  const validatorCtx: ValidatorContext = {
    knownToolNames: deps.knownToolNames,
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
  // render 接受通用 Record<string, unknown>;TemplateContext 强转是签名兼容必需(编码指南 #4)。
  const renderTpl = (ctx: TemplateContext): string =>
    render(template, ctx as unknown as Record<string, unknown>, {})
  const baseCtx = buildRuntimeContext(agent)
  const samples = {
    firstIteration: renderTpl(baseCtx),
    midIteration: renderTpl(baseCtx),
    lastIteration: renderTpl(baseCtx),
  }

  // 4. 已启用工具
  const builtinNames = agent.toolRegistry.listBuiltinTools().map((t) => t.name)
  const enabledTools: PreviewToolInfo[] = agent.toolRegistry.listBuiltinTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters as unknown,
    source: builtinNames.includes(t.name) ? 'builtin' : 'agent-private',
  }))

  return {
    renderedPrompt: {
      persistent: samples.firstIteration,
      onDemandSamples: samples,
    },
    enabledTools,
    estimates: {
      promptTokens: Math.ceil(samples.firstIteration.length / 3),
      toolsCount: enabledTools.length,
    },
    validatorIssues,
  }
}
