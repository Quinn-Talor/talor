// src/main/prompt/runtime-context.ts — 业务层: 模板渲染上下文 (Schema 2.0)
//
// 把 Agent 实体属性 → TemplateContext (供 render.ts 消费)。
// 大幅简化: 不再有 mission/method/delivery 段渲染,只剩 identity (扁平) + agentPrompt 自由文本 +
// references 索引 + skills listing。
//
// 允许依赖: agent/*、shared/*
// 禁止依赖: ipc/*

import type { Agent } from '../agent/agent'
import type { AgentProfile, ReferenceFile } from '@shared/types/agent'

export interface RuntimeIterationState {
  /** ReAct iteration 计数 (0-based) — 当前 v2.0 模板不用,保留供后续扩展 */
  iterationNumber: number
  /** 累计 token 用量 — 当前 v2.0 模板不用,保留供后续扩展 */
  tokensUsed: number
}

export interface TemplateContext {
  // ── 顶层标识 (模板直接读) ──
  name: string
  description: string
  agentPrompt: string

  // ── References 段 ──
  hasReferences: boolean
  references: ReferenceFile[]

  // ── Critical role constraints (platform agent 内置) ──
  criticalRoleConstraints: string[]

  // ── Skills listing (从 SkillRegistry 渲染好的字符串,空则段省略) ──
  hasSkillListing: boolean
  skillListing: string
}

export function buildRuntimeContext(agent: Agent, _state: RuntimeIterationState): TemplateContext {
  const p = agent.profile
  const references = p.references ?? []

  return {
    name: p.name,
    description: p.description,
    agentPrompt: p.agentPrompt,

    hasReferences: references.length > 0,
    references,

    criticalRoleConstraints: buildCriticalRoleConstraints(p.id),

    skillListing: renderSkillListing(agent.skillRegistry),
    hasSkillListing: !agent.skillRegistry.isEmpty() && agent.skillRegistry.listAll().length > 0,
  }
}

function buildCriticalRoleConstraints(agentId: string): string[] {
  if (agentId === '__chat__') {
    return [
      'You may delegate sub-tasks via delegate_agent when specialized agents fit better than direct work.',
    ]
  }
  return []
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

  return `## Available Skills\n\nEach entry is an encapsulated capability. Use via \`skill\` tool. The "When to use" line lists trigger phrases — match the user's input against these to pick a skill.\n\n${listing}`
}

// Re-export for back-compat (Profile is no longer the prompt shape itself)
export type { AgentProfile }
