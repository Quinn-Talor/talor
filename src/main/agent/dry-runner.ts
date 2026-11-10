// src/main/agent/dry-runner.ts — 业务层: Agent 沙箱试跑 (Schema 2.0 simplified)
//
// 不再做 acceptance / extractDeliverable / schema 校验 (deliverables 已删)。
// 当前能力: 校验 profile + 给出发给模型的指令(agentPrompt 原文) + 报告资源估算。
// 未来想做"输出符合 agentPrompt ## Output 段"的语义评估时,接 LLM-judge,
// 不再走 schema 路径。
//
// 允许依赖: agent/*、shared/*
// 禁止依赖: ipc/*

import type { AgentProfile } from '@shared/types/agent'
import { validateProfile } from './validator'

export interface DryRunIteration {
  iteration: number
  promptSent: string
  llmResponseStub: string
  toolCallsStub: Array<{ tool: string; input: unknown }>
  tokensUsedEstimate: number
}

export interface DryRunResult {
  iterations: DryRunIteration[]
  finalText: string
  resourceUsage: {
    iterations: number
    promptTokensEstimate: number
  }
  validatorIssues: import('@shared/types/agent').ValidatorIssue[]
  stub: true
  notes: string[]
}

export interface DryRunArgs {
  profile: unknown
  userMessage: string
  finalTextOverride?: string
  toolEventsOverride?: Array<{
    toolName: string
    input?: { path?: string } & Record<string, unknown>
  }>
}

export async function dryRunAgent(args: DryRunArgs): Promise<DryRunResult> {
  const validation = validateProfile(args.profile)
  if (!validation.valid) {
    return {
      iterations: [],
      finalText: '',
      resourceUsage: { iterations: 0, promptTokensEstimate: 0 },
      validatorIssues: [...validation.errors, ...validation.warnings],
      stub: true,
      notes: ['profile validation failed; dry-run aborted'],
    }
  }

  const profile: AgentProfile = validation.profile

  const persistentPrompt = profile.agentPrompt

  const finalText = args.finalTextOverride ?? `[dry-run stub] User asked: ${args.userMessage}`
  const toolEvents = args.toolEventsOverride ?? []

  const iter: DryRunIteration = {
    iteration: 0,
    promptSent: persistentPrompt,
    llmResponseStub: finalText,
    toolCallsStub: toolEvents.map((e) => ({ tool: e.toolName, input: e.input })),
    tokensUsedEstimate: Math.ceil(persistentPrompt.length / 3),
  }

  return {
    iterations: [iter],
    finalText,
    resourceUsage: {
      iterations: 1,
      promptTokensEstimate: iter.tokensUsedEstimate,
    },
    validatorIssues: validation.warnings,
    stub: true,
    notes: [
      'Schema 2.0 dry-run: profile validated; promptSent is the agentPrompt sent as instructions.',
      'No acceptance / deliverable validation in v2.0; output checking relies on prompt + LLM.',
    ],
  }
}
