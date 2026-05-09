// src/main/agent/dry-runner.ts — 业务层：Agent 沙箱试跑 (P0 simplified)
//
// IPC `agents:dry-run` 调用入口.
//
// P0 simplified scope:
//   - 不调真实 LLM (避免 cost + 沙箱复杂性)
//   - 输入: profile + userMessage
//   - 输出: 渲染 prompt + 模拟 acceptance 校验报告 + 资源估算
//   - 真实 ReactLoop 在 P1 接入 (需要 sandbox messageRepo + provider 隔离)
//
// 允许依赖: agent/*、prompt/*、loop/contract-guard、shared/*
// 禁止依赖: ipc/*

import type { AgentProfile, AcceptanceCriterion } from '@shared/types/agent'
import { validateProfile } from './validator'
import { Agent } from './agent'
import { BuiltinToolRegistry } from './builtin-registry'
import { SkillRegistry } from '../skills/registry'
import { render } from '../prompt/render'
import { naturalize, schemaToBullets } from '../prompt/naturalize'
import { buildRuntimeContext, type TemplateContext } from '../prompt/runtime-context'
import { loadAgentSystemPromptTemplate } from '../prompt/template-loader'
import { verify } from '../loop/contract-guard'
import type { VerifyFailure } from '../loop/contract-guard'

export interface DryRunIteration {
  iteration: number
  promptSent: string
  llmResponseStub: string
  toolCallsStub: Array<{ tool: string; input: unknown }>
  tokensUsedEstimate: number
}

export interface DryRunResult {
  /** 简化:P0 仅渲染一次 prompt 作为 'first iteration sample' */
  iterations: DryRunIteration[]
  finalText: string
  extractedDeliverables: Record<string, unknown>
  acceptance: {
    overallPassed: boolean
    must: Array<{ criterion: AcceptanceCriterion; passed: boolean; reason?: string }>
    should: Array<{ criterion: AcceptanceCriterion; passed: boolean; reason?: string }>
  }
  resourceUsage: {
    iterations: number
    promptTokensEstimate: number
    sandboxApplied: { maxSteps: number; maxTokens: number }
  }
  validatorIssues: import('@shared/types/agent').ValidatorIssue[]
  /** 标记 P0 stub */
  stub: true
  notes: string[]
}

export interface DryRunArgs {
  profile: unknown
  userMessage: string
  /** 可选:提供真实 LLM 输出供 acceptance 测试 */
  finalTextOverride?: string
  /** 可选:提供工具事件供 acceptance 测试 */
  toolEventsOverride?: Array<{
    toolName: string
    input?: { path?: string } & Record<string, unknown>
  }>
}

const SANDBOX_LIMITS = { maxSteps: 10, maxTokens: 20000 }

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

export async function dryRunAgent(args: DryRunArgs): Promise<DryRunResult> {
  // 1. 校验
  const validation = validateProfile(args.profile)
  if (!validation.valid) {
    return {
      iterations: [],
      finalText: '',
      extractedDeliverables: {},
      acceptance: { overallPassed: false, must: [], should: [] },
      resourceUsage: {
        iterations: 0,
        promptTokensEstimate: 0,
        sandboxApplied: SANDBOX_LIMITS,
      },
      validatorIssues: [...validation.errors, ...validation.warnings],
      stub: true,
      notes: ['profile validation failed; dry-run aborted'],
    }
  }

  const profile = validation.profile

  // 2. 用沙箱 limits override
  const sandboxedProfile: AgentProfile = {
    ...profile,
    execution: {
      ...profile.execution,
      limits: {
        maxSteps: Math.min(profile.execution.limits.maxSteps, SANDBOX_LIMITS.maxSteps),
        maxTokens: Math.min(profile.execution.limits.maxTokens, SANDBOX_LIMITS.maxTokens),
      },
    },
  }

  // 3. 临时 Agent 实例(空 builtin → 不实际执行任何工具)
  const emptyBuiltin = new BuiltinToolRegistry([])
  const agent = new Agent({
    profile: sandboxedProfile,
    source: null,
    builtinRegistry: emptyBuiltin,
    mcpRegistry: null,
    skillRegistry: SkillRegistry.fromDir(null),
    delegationRuntime: undefined, // dry-run 不允许下钻
  })

  // 4. 渲染 first-iteration prompt 作为 sample
  const template = loadAgentSystemPromptTemplate()
  const tplCtx: TemplateContext = buildRuntimeContext(agent, {
    iterationNumber: 0,
    tokensUsed: 0,
  })
  // render 接受通用 Record<string, unknown>;TemplateContext 强转是签名兼容必需(编码指南 #4)。
  const persistentPrompt = render(template, tplCtx as unknown as Record<string, unknown>, helpers)

  // 5. 模拟单 iteration
  const finalText = args.finalTextOverride ?? `[dry-run stub] User asked: ${args.userMessage}`
  const toolEvents = args.toolEventsOverride ?? []

  const iter: DryRunIteration = {
    iteration: 0,
    promptSent: persistentPrompt,
    llmResponseStub: finalText,
    toolCallsStub: toolEvents.map((e) => ({ tool: e.toolName, input: e.input })),
    tokensUsedEstimate: Math.ceil(persistentPrompt.length / 3),
  }

  // 6. 跑 contract-guard.verify (真实 acceptance 评估)
  const verifyResult = await verify(agent.resolvedAcceptance, {
    finalText,
    toolEvents,
    agent: {
      profile: sandboxedProfile,
      toolRegistry: {
        execute: async () => ({
          __talor_error: true,
          message: 'dry-run sandbox: verifier-tool execution stubbed',
        }),
      },
    },
  })

  const must = agent.resolvedAcceptance
    .filter((c) => (c.severity ?? 'must') === 'must')
    .map((c) => {
      const f = verifyResult.failures.find((x) => x.criterion === c)
      return f ? { criterion: c, passed: false, reason: f.reason } : { criterion: c, passed: true }
    })
  const should = agent.resolvedAcceptance
    .filter((c) => c.severity === 'should')
    .map((c) => {
      const f = verifyResult.failures.find((x) => x.criterion === c)
      return f ? { criterion: c, passed: false, reason: f.reason } : { criterion: c, passed: true }
    })

  // 7. 提取 deliverables
  const extracted: Record<string, unknown> = {}
  for (const d of profile.delivery.deliverables) {
    const { extractDeliverable } = await import('../loop/contract-guard')
    const out = extractDeliverable(
      finalText,
      d,
      toolEvents as Parameters<typeof extractDeliverable>[2],
    )
    if (out !== null) extracted[d.id] = out
  }

  return {
    iterations: [iter],
    finalText,
    extractedDeliverables: extracted,
    acceptance: {
      overallPassed: verifyResult.passed,
      must,
      should,
    },
    resourceUsage: {
      iterations: 1,
      promptTokensEstimate: iter.tokensUsedEstimate,
      sandboxApplied: SANDBOX_LIMITS,
    },
    validatorIssues: validation.warnings,
    stub: true,
    notes: [
      'P0 stub: real ReactLoop / LLM call not invoked in sandbox.',
      'Provide finalTextOverride + toolEventsOverride to test acceptance scenarios.',
    ],
  }
}

// re-export for clarity
export type { VerifyFailure }
