// src/main/agent/preview.ts — 业务层：Agent profile 预览
//
// IPC `agents:preview` 调用入口。
// 输入: profile (any object) → 输出: PreviewResult (供 UI 直接展示)。
// 提示词为 agentPrompt 原文（引擎的指令就是它）；工具为能力目录按 profile 选出的内置工具与 Feature 工具。
//
// 允许依赖: agent/*、runtime/catalog（类型）、shared/*
// 禁止依赖: ipc/*

import type { AgentProfile, ValidatorIssue } from '@shared/types/agent'
import { validateProfile } from './validator'
import type { CatalogSnapshot } from '../runtime/catalog'

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
  snapshot: CatalogSnapshot
}

export async function previewAgent(
  profileInput: unknown,
  deps: PreviewDeps,
): Promise<PreviewResult> {
  // 1. validate (尽力,即使非法也继续)
  const validation = validateProfile(profileInput)
  const validatorIssues: ValidatorIssue[] = validation.valid
    ? validation.warnings
    : [...validation.errors, ...validation.warnings]

  const profile = (
    validation.valid ? validation.profile : (profileInput as AgentProfile)
  ) as AgentProfile

  // 2. 提示词:agentPrompt 原文,三个阶段同值
  const prompt = typeof profile?.agentPrompt === 'string' ? profile.agentPrompt : ''

  // 3. 已启用工具:目录为该 profile 选出的内置工具与 Feature 工具
  const caps = typeof profile?.id === 'string' ? deps.snapshot.select(profile) : null
  const enabledTools: PreviewToolInfo[] = caps
    ? [...caps.builtins, ...caps.featureTools].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters as unknown,
        source: 'builtin',
      }))
    : []

  return {
    renderedPrompt: {
      persistent: prompt,
      onDemandSamples: { firstIteration: prompt, midIteration: prompt, lastIteration: prompt },
    },
    enabledTools,
    estimates: {
      promptTokens: Math.ceil(prompt.length / 3),
      toolsCount: enabledTools.length,
    },
    validatorIssues,
  }
}
